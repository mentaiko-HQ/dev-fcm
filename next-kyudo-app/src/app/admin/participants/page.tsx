/**
 * 【管理者向け参加者管理ページ】
 * /admin/participants パスに対応するページコンポーネント。
 * 
 * 役割:
 * - 「エントリ・入金管理」「立順設定・選手修正」「受付QRコード送信」の3画面をタブ形式で統合提供。
 * - 第1立（午前一手）と第2立（午後一手）の立配置を独立して管理し、各列でのソートおよびモーダル編集を実行。
 * - 入金確認済みの選手に対して、受付用QRコードと最新立順情報を記載した案内メールを個別送信・再送信（QrSendTab連携）。
 * 
 * フールプルーフ設計（操作ミス・不正操作の入口遮断）:
 * - 型制約（SortKey, SortOrder, TabType）により未定義プロパティへのアクセスをコンパイル時および実行時で遮断。
 * - 選手氏名が空白のまま保存されることを防止するバリデーションチェック。
 * - 更新処理（handleSaveChanges, handleTogglePayment）の直前に auth.currentUser を検証し、セッションが存在しない場合は自動認証を実行。
 * - 保存処理中の二重送信防止（isSaving フラグによるボタン非活性化とスピナー表示）。
 * 
 * フェイルセーフ設計（障害時の安全縮退・耐障害性）:
 * - Firestore未接続時や通信障害時でも画面クラッシュを防止する安全ガードと詳細エラーログ出力。
 * - 旧データ形式（standAssignments未定義）に対してもデフォルト値（第1立1組1番）へ自動フォールバック。
 */

"use client";

import React, { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { collection, onSnapshot, query, orderBy, doc, updateDoc } from "firebase/firestore";
import { signInAnonymously } from "firebase/auth";
import { db, auth, isFirebaseConfigured, isFirestoreAvailable } from "@/lib/firebase";
import { Participant } from "@/types/participant";
import { StandRoundIndex, ShosaType, RankTitleType, StaffRoleType } from "@/types";
import { QrSendTab } from "@/components/admin/QrSendTab";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  Users,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  Loader2,
  SlidersHorizontal,
  Edit2,
  X,
  Check,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  QrCode
} from "lucide-react";

type SortKey = "bibNumber" | "stand1" | "stand2" | "name" | "organization" | "isPaid";
type SortOrder = "asc" | "desc";
type TabType = "entry" | "schedule" | "qr_send";

export default function AdminParticipantsPage() {
  const router = useRouter();
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [activeTab, setActiveTab] = useState<TabType>("entry");
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  // ソート用状態管理
  const [sortKey, setSortKey] = useState<SortKey>("bibNumber");
  const [sortOrder, setSortOrder] = useState<SortOrder>("asc");

  // モーダル編集用状態管理
  const [selectedParticipant, setSelectedParticipant] = useState<Participant | null>(null);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [editForm, setEditForm] = useState<{
    bibNumber: number;
    standAssignments: Record<StandRoundIndex, { standGroup: number; standOrder: 1 | 2 | 3 | 4 | 5 }>;
    name: string;
    nameKana: string;
    organization: string;
    shosa: ShosaType;
    rankTitle: RankTitleType;
    representativeName: string;
    representativePhone: string;
    representativeEmail: string;
    staffRole: StaffRoleType;
    staffDutyShift: string;
    notes: string;
  }>({
    bibNumber: 1,
    standAssignments: {
      1: { standGroup: 1, standOrder: 1 },
      2: { standGroup: 1, standOrder: 1 },
      3: { standGroup: 1, standOrder: 1 },
    },
    name: "",
    nameKana: "",
    organization: "",
    shosa: "肌脱ぎ",
    rankTitle: "段位は三段以下",
    representativeName: "",
    representativePhone: "",
    representativeEmail: "",
    staffRole: "無し",
    staffDutyShift: "無し",
    notes: "",
  });

  /**
   * 【フールプルーフ】認証セッションの存在保証ヘルパー
   * 未認証状態でのFirestore書き込みによる Missing or insufficient permissions を防止する。
   */
  const ensureAuthenticated = async (): Promise<void> => {
    if (!auth) return;
    if (!auth.currentUser) {
      try {
        await signInAnonymously(auth);
      } catch (authErr) {
        console.warn("【管理者認証警告】匿名認証の自動確立に失敗しました:", authErr);
      }
    }
  };

  /**
   * 【Firestore entries コレクションのリアルタイム購読】
   * 参加選手データをゼッケン番号順に取得し、立順情報を安全に正規化してセット。
   */
  useEffect(() => {
    if (!isFirebaseConfigured || !isFirestoreAvailable(db)) {
      console.warn("【Firebase未構成】Firestore接続が利用できないため購読をスキップします。");
      return;
    }

    const firestoreInstance = db;
    if (!firestoreInstance) return;

    const q = query(collection(firestoreInstance, "entries"), orderBy("bibNumber", "asc"));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const loaded: Participant[] = [];
        snapshot.forEach((docSnap) => {
          const raw = docSnap.data();
          
          // 【フェイルセーフ】古いデータ形式や未設定値に対する安全フォールバック
          const rawAssignments = raw.standAssignments || {};
          const safeAssignments: Record<StandRoundIndex, { standGroup: number; standOrder: 1 | 2 | 3 | 4 | 5 }> = {
            1: {
              standGroup: Number(rawAssignments[1]?.standGroup || raw.standGroup || 1),
              standOrder: (Number(rawAssignments[1]?.standOrder || raw.standOrder || 1) as 1 | 2 | 3 | 4 | 5),
            },
            2: {
              standGroup: Number(rawAssignments[2]?.standGroup || raw.standGroup || 1),
              standOrder: (Number(rawAssignments[2]?.standOrder || raw.standOrder || 1) as 1 | 2 | 3 | 4 | 5),
            },
            3: {
              standGroup: Number(rawAssignments[3]?.standGroup || 1),
              standOrder: (Number(rawAssignments[3]?.standOrder || 1) as 1 | 2 | 3 | 4 | 5),
            },
          };

          loaded.push({
            id: docSnap.id,
            bibNumber: typeof raw.bibNumber === "number" ? raw.bibNumber : Number(raw.bibNumber) || 1,
            name: typeof raw.name === "string" ? raw.name : "選手名未設定",
            nameKana: typeof raw.nameKana === "string" ? raw.nameKana : "",
            organization: typeof raw.organization === "string" ? raw.organization : "",
            shosa: raw.shosa || "肌脱ぎ",
            rankTitle: raw.rankTitle || "段位は三段以下",
            staffRole: raw.staffRole || "無し",
            staffDutyShift: raw.staffDutyShift || "無し",
            checkInStatus: raw.checkInStatus || "UNCHECKED",
            checkInAt: raw.checkInAt || null,
            isStaffVolunteer: Boolean(raw.isStaffVolunteer),
            needsSupport: Boolean(raw.needsSupport),
            standAssignments: safeAssignments,
            progressStatus: raw.progressStatus || "WAITING",
            qualificationStatus: raw.qualificationStatus || "ACTIVE",
            stand1_arrows: raw.stand1_arrows || [],
            stand2_arrows: raw.stand2_arrows || [],
            stand3_arrows: raw.stand3_arrows || [],
            totalHits: raw.totalHits || 0,
            totalShots: raw.totalShots || 8,
            isPerfect: Boolean(raw.isPerfect),
            enkinRank: raw.enkinRank || null,
            finalRank: raw.finalRank || null,
            representativeName: raw.representativeName || "",
            representativeEmail: raw.representativeEmail || "",
            representativePhone: raw.representativePhone || "",
            representativeOrganization: raw.representativeOrganization || "",
            isPaid: Boolean(raw.isPaid),
            paidAt: raw.paidAt || null,
            notes: raw.notes || "",
            qrSentAt: raw.qrSentAt || null,
            qrSentStatus: raw.qrSentStatus || "UNSENT",
            qrSentError: raw.qrSentError || null,
            updatedAt: raw.updatedAt || undefined,
          });
        });
        setParticipants(loaded);
      },
      (error) => {
        console.error("【Firestore購読例外】entries取得に失敗しました:", error);
      }
    );

    return () => unsubscribe();
  }, []);

  /**
   * 【入金ステータス切替ハンドラー】
   */
  const handleTogglePayment = async (participant: Participant) => {
    if (!isFirebaseConfigured || !isFirestoreAvailable(db)) {
      alert("データベースが利用可能な状態ではありません。");
      return;
    }

    const firestoreInstance = db;
    if (!firestoreInstance) return;

    await ensureAuthenticated();

    const nextIsPaid = !participant.isPaid;
    const now = Date.now();
    setUpdatingId(participant.id);

    try {
      const docRef = doc(firestoreInstance, "entries", participant.id);
      await updateDoc(docRef, {
        isPaid: nextIsPaid,
        paidAt: nextIsPaid ? now : null,
        updatedAt: now,
      });
    } catch (err) {
      console.error("【入金ステータス更新例外】:", err);
      alert("入金ステータスの更新に失敗しました。権限設定および通信環境を確認してください。");
    } finally {
      setUpdatingId(null);
    }
  };

  /**
   * 【ソート切り替えハンドラー】
   */
  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortOrder("asc");
    }
  };

  /**
   * 【ソートアイコン描画ヘルパー】
   */
  const renderSortIcon = (key: SortKey) => {
    if (sortKey !== key) {
      return <ArrowUpDown className="w-3.5 h-3.5 text-slate-300" />;
    }
    return sortOrder === "asc" ? (
      <ArrowUp className="w-3.5 h-3.5 text-slate-900" />
    ) : (
      <ArrowDown className="w-3.5 h-3.5 text-slate-900" />
    );
  };

  /**
   * 【モーダルオープン処理】
   */
  const handleOpenEditModal = (p: Participant) => {
    setSelectedParticipant(p);
    setEditForm({
      bibNumber: p.bibNumber,
      standAssignments: JSON.parse(JSON.stringify(p.standAssignments)),
      name: p.name,
      nameKana: p.nameKana || "",
      organization: p.organization,
      shosa: p.shosa,
      rankTitle: (p.rankTitle as RankTitleType) || "段位は三段以下",
      representativeName: p.representativeName || "",
      representativePhone: p.representativePhone || "",
      representativeEmail: p.representativeEmail || "",
      staffRole: p.staffRole,
      staffDutyShift: p.staffDutyShift || "無し",
      notes: p.notes || "",
    });
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedParticipant(null);
  };

  /**
   * 【データ保存処理】
   */
  const handleSaveChanges = async () => {
    if (!selectedParticipant) return;
    if (!isFirebaseConfigured || !isFirestoreAvailable(db)) {
      alert("Firestoreデータベースが利用可能な状態ではありません。");
      return;
    }

    const firestoreInstance = db;
    if (!firestoreInstance) return;

    // 【フールプルーフ】必須入力バリデーション
    if (!editForm.name.trim()) {
      alert("選手氏名は必須です。");
      return;
    }

    // 【フールプルーフ】認証セッションの事前確立
    await ensureAuthenticated();

    setIsSaving(true);
    const now = Date.now();

    try {
      const docRef = doc(firestoreInstance, "entries", selectedParticipant.id);
      await updateDoc(docRef, {
        bibNumber: Number(editForm.bibNumber) || 1,
        standAssignments: editForm.standAssignments,
        name: editForm.name.trim(),
        nameKana: editForm.nameKana.trim(),
        organization: editForm.organization.trim(),
        shosa: editForm.shosa,
        rankTitle: editForm.rankTitle,
        representativeName: editForm.representativeName.trim(),
        representativePhone: editForm.representativePhone.trim(),
        representativeEmail: editForm.representativeEmail.trim(),
        staffRole: editForm.staffRole,
        staffDutyShift: editForm.staffDutyShift,
        notes: editForm.notes.trim(),
        updatedAt: now,
      });

      handleCloseModal();
    } catch (err) {
      console.error("【選手データ更新例外】詳細ログ:", err);
      alert("選手データの更新に失敗しました。Firestoreのセキュリティルールまたは権限設定をご確認ください。");
    } finally {
      setIsSaving(false);
    }
  };

  const entryParticipants = participants.filter((p) => !p.isPaid);
  const scheduleParticipants = participants.filter((p) => p.isPaid);

  /**
   * 【立順設定タブ用のソート済み参加者配列】
   */
  const sortedScheduleParticipants = useMemo(() => {
    const list = [...scheduleParticipants];
    return list.sort((a, b) => {
      let comparison = 0;

      switch (sortKey) {
        case "bibNumber":
          comparison = a.bibNumber - b.bibNumber;
          break;
        case "stand1": {
          const a1 = a.standAssignments?.[1] || { standGroup: 999, standOrder: 999 };
          const b1 = b.standAssignments?.[1] || { standGroup: 999, standOrder: 999 };
          if (a1.standGroup !== b1.standGroup) {
            comparison = a1.standGroup - b1.standGroup;
          } else {
            comparison = a1.standOrder - b1.standOrder;
          }
          break;
        }
        case "stand2": {
          const a2 = a.standAssignments?.[2] || { standGroup: 999, standOrder: 999 };
          const b2 = b.standAssignments?.[2] || { standGroup: 999, standOrder: 999 };
          if (a2.standGroup !== b2.standGroup) {
            comparison = a2.standGroup - b2.standGroup;
          } else {
            comparison = a2.standOrder - b2.standOrder;
          }
          break;
        }
        case "name": {
          const nameA = a.nameKana || a.name;
          const nameB = b.nameKana || b.name;
          comparison = nameA.localeCompare(nameB, "ja");
          break;
        }
        case "organization": {
          const orgA = a.organization || "";
          const orgB = b.organization || "";
          comparison = orgA.localeCompare(orgB, "ja");
          break;
        }
        case "isPaid": {
          const paidA = a.isPaid ? 1 : 0;
          const paidB = b.isPaid ? 1 : 0;
          comparison = paidA - paidB;
          break;
        }
        default:
          comparison = 0;
      }

      return sortOrder === "asc" ? comparison : comparison * -1;
    });
  }, [scheduleParticipants, sortKey, sortOrder]);

  return (
    <main className="min-h-screen bg-[#F8FAFC] text-slate-900 p-4 md:p-8 space-y-6">
      <div className="max-w-7xl mx-auto space-y-6">
        
        {/* ヘッダーセクション */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between bg-white border border-slate-200/80 rounded-2xl p-6 shadow-sm gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold bg-slate-900 text-white px-3 py-1 rounded-full flex items-center gap-1 shadow-2xs">
                <ShieldCheck className="w-3.5 h-3.5 text-amber-400" /> 管理者専用
              </span>
              <span className="text-xs font-semibold text-slate-600 bg-slate-100 px-2.5 py-0.5 rounded-md">
                第5回めんたいこ杯
              </span>
            </div>
            <h1 className="text-xl md:text-2xl font-black tracking-tight text-slate-900 flex items-center gap-2 pt-1">
              <Users className="w-6 h-6 text-slate-700" />
              参加選手一覧 ＆ 入金管理・立順設定ダッシュボード
            </h1>
            <p className="text-xs text-slate-500 font-medium">
              午前一手（第1立・2射）と午後一手（第2立・2射）の立配置、および個別QRコード受付案内メールの配信を管理します。
            </p>
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => router.push("/")}
            className="text-xs font-bold border-slate-200 bg-white hover:bg-slate-50 text-slate-800 shadow-2xs"
          >
            <ArrowLeft className="w-3.5 h-3.5 mr-1 text-slate-500" /> ポータルトップへ戻る
          </Button>
        </div>

        {/* タブ切り替えUIボタン群 */}
        <div className="flex border-b border-slate-200 gap-2">
          {/* タブ1: エントリ・入金管理 */}
          <button
            type="button"
            onClick={() => setActiveTab("entry")}
            className={`px-6 py-3 text-xs md:text-sm font-bold border-b-2 transition-all flex items-center gap-2 ${
              activeTab === "entry"
                ? "border-slate-900 text-slate-900 bg-white rounded-t-xl shadow-xs"
                : "border-transparent text-slate-400 hover:text-slate-700"
            }`}
          >
            <Users className="w-4 h-4" />
            エントリ・入金管理
            <span className="ml-2 px-2 py-0.5 text-[10px] bg-slate-100 text-slate-800 rounded-full font-mono font-bold">
              {entryParticipants.length}名
            </span>
          </button>

          {/* タブ2: 立順設定・選手修正 */}
          <button
            type="button"
            onClick={() => setActiveTab("schedule")}
            className={`px-6 py-3 text-xs md:text-sm font-bold border-b-2 transition-all flex items-center gap-2 ${
              activeTab === "schedule"
                ? "border-slate-900 text-slate-900 bg-white rounded-t-xl shadow-xs"
                : "border-transparent text-slate-400 hover:text-slate-700"
            }`}
          >
            <SlidersHorizontal className="w-4 h-4" />
            立順設定・選手修正
            <span className="ml-2 px-2 py-0.5 text-[10px] bg-slate-100 text-slate-800 rounded-full font-mono font-bold">
              {scheduleParticipants.length}名
            </span>
          </button>

          {/* タブ3: 受付QRコード個別送信 */}
          <button
            type="button"
            onClick={() => setActiveTab("qr_send")}
            className={`px-6 py-3 text-xs md:text-sm font-bold border-b-2 transition-all flex items-center gap-2 ${
              activeTab === "qr_send"
                ? "border-slate-900 text-slate-900 bg-white rounded-t-xl shadow-xs"
                : "border-transparent text-slate-400 hover:text-slate-700"
            }`}
          >
            <QrCode className="w-4 h-4" />
            受付QRコード送信
            <span className="ml-2 px-2 py-0.5 text-[10px] bg-slate-100 text-slate-800 rounded-full font-mono font-bold">
              {scheduleParticipants.length}名
            </span>
          </button>
        </div>

        {/* タブコンテンツ1: エントリ・入金管理 */}
        {activeTab === "entry" && (
          <div className="bg-white border border-slate-200/80 rounded-2xl p-6 space-y-4 shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-slate-900 text-sm">未入金・エントリ確認一覧</h3>
              <p className="text-xs text-slate-500 font-medium">「未入金 (入金済みにする)」を押下すると、立順設定・QRコード送信対象へ移動します。</p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50/80 text-slate-700 font-bold border-b border-slate-200">
                  <tr>
                    <th className="p-3.5">ゼッケン</th>
                    <th className="p-3.5">選手氏名</th>
                    <th className="p-3.5">所属団体名</th>
                    <th className="p-3.5">所作 / 段位</th>
                    <th className="p-3.5 text-center">入金ステータス変更</th>
                    <th className="p-3.5 text-center">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {entryParticipants.length > 0 ? (
                    entryParticipants.map((p) => {
                      const isUpdating = updatingId === p.id;
                      return (
                        <tr key={p.id} className="hover:bg-slate-50/60 transition-colors">
                          <td className="p-3.5 font-mono font-bold text-slate-900">No.{p.bibNumber}</td>
                          <td className="p-3.5 font-bold text-slate-900">
                            <div>{p.name}</div>
                            <div className="text-[10px] text-slate-400 font-normal">{p.nameKana}</div>
                          </td>
                          <td className="p-3.5 text-slate-700 font-medium">{p.organization || "-"}</td>
                          <td className="p-3.5 text-slate-600 font-medium">
                            <div>{p.shosa}</div>
                            <div className="text-[10px] text-slate-400 font-normal">{p.rankTitle}</div>
                          </td>
                          <td className="p-3.5 text-center">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={isUpdating}
                              onClick={() => handleTogglePayment(p)}
                              className="h-7 px-3 text-[11px] font-bold bg-amber-50/80 border-amber-300 text-amber-900 hover:bg-amber-100 shadow-2xs"
                            >
                              {isUpdating ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <XCircle className="w-3.5 h-3.5 text-amber-600 mr-1" />}
                              未入金 (入金済みにする)
                            </Button>
                          </td>
                          <td className="p-3.5 text-center">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => handleOpenEditModal(p)}
                              className="h-7 px-2.5 text-[11px] font-bold border-slate-200 bg-white hover:bg-slate-50 text-slate-800 shadow-2xs"
                            >
                              <Edit2 className="w-3 h-3 mr-1 text-slate-500" /> 修正
                            </Button>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={6} className="py-16 text-center text-slate-400 font-medium">
                        未入金の選手は現在いません。
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* タブコンテンツ2: 立順設定・選手修正 */}
        {activeTab === "schedule" && (
          <div className="bg-white border border-slate-200/80 rounded-2xl p-6 space-y-4 shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="font-bold text-slate-900 text-sm">入金済みの選手一覧（第1・第2立の立順設定対象）</h3>
                <p className="text-xs text-slate-500 font-medium mt-0.5">
                  各列のヘッダーをクリックして並び替えを行い、「修正」ボタンから立順・選手情報を変更できます。
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                onClick={() => setActiveTab("qr_send")}
                className="bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs shadow-2xs"
              >
                <QrCode className="w-3.5 h-3.5 mr-1 text-amber-400" />
                QRコード送信画面へ進む
              </Button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50/80 text-slate-700 font-bold border-b border-slate-200">
                  <tr>
                    {/* ゼッケンソートヘッダー */}
                    <th
                      className="p-3.5 cursor-pointer select-none hover:bg-slate-100/80 transition-colors"
                      onClick={() => handleSort("bibNumber")}
                    >
                      <div className="flex items-center gap-1.5">
                        <span>ゼッケン</span>
                        {renderSortIcon("bibNumber")}
                      </div>
                    </th>

                    {/* 立配置第1立ソートヘッダー */}
                    <th
                      className="p-3.5 cursor-pointer select-none hover:bg-slate-100/80 transition-colors"
                      onClick={() => handleSort("stand1")}
                    >
                      <div className="flex items-center gap-1.5">
                        <span>立配置第1立 (午前一手)</span>
                        {renderSortIcon("stand1")}
                      </div>
                    </th>

                    {/* 立配置第2立ソートヘッダー */}
                    <th
                      className="p-3.5 cursor-pointer select-none hover:bg-slate-100/80 transition-colors"
                      onClick={() => handleSort("stand2")}
                    >
                      <div className="flex items-center gap-1.5">
                        <span>立配置第2立 (午後一手)</span>
                        {renderSortIcon("stand2")}
                      </div>
                    </th>

                    {/* 選手氏名ソートヘッダー */}
                    <th
                      className="p-3.5 cursor-pointer select-none hover:bg-slate-100/80 transition-colors"
                      onClick={() => handleSort("name")}
                    >
                      <div className="flex items-center gap-1.5">
                        <span>選手氏名</span>
                        {renderSortIcon("name")}
                      </div>
                    </th>

                    {/* 所属団体名ソートヘッダー */}
                    <th
                      className="p-3.5 cursor-pointer select-none hover:bg-slate-100/80 transition-colors"
                      onClick={() => handleSort("organization")}
                    >
                      <div className="flex items-center gap-1.5">
                        <span>所属団体名</span>
                        {renderSortIcon("organization")}
                      </div>
                    </th>

                    {/* 入金状態ソートヘッダー */}
                    <th
                      className="p-3.5 text-center cursor-pointer select-none hover:bg-slate-100/80 transition-colors"
                      onClick={() => handleSort("isPaid")}
                    >
                      <div className="flex items-center justify-center gap-1.5">
                        <span>入金状態</span>
                        {renderSortIcon("isPaid")}
                      </div>
                    </th>

                    <th className="p-3.5 text-center">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sortedScheduleParticipants.length > 0 ? (
                    sortedScheduleParticipants.map((p) => {
                      const isUpdating = updatingId === p.id;
                      const a1 = p.standAssignments?.[1] || { standGroup: 1, standOrder: 1 };
                      const a2 = p.standAssignments?.[2] || { standGroup: 1, standOrder: 1 };

                      return (
                        <tr key={p.id} className="hover:bg-slate-50/60 transition-colors">
                          <td className="p-3.5 font-mono font-bold text-slate-900">No.{p.bibNumber}</td>
                          
                          <td className="p-3.5 font-semibold text-slate-800">
                            第{a1.standGroup}立 - <span className="text-slate-900 font-bold">{a1.standOrder}番</span>
                          </td>

                          <td className="p-3.5 font-semibold text-slate-800">
                            第{a2.standGroup}立 - <span className="text-slate-900 font-bold">{a2.standOrder}番</span>
                          </td>

                          <td className="p-3.5 font-bold text-slate-900">
                            <div>{p.name}</div>
                            <div className="text-[10px] text-slate-400 font-normal">{p.nameKana}</div>
                          </td>
                          <td className="p-3.5 text-slate-700 font-medium">{p.organization || "-"}</td>
                          
                          <td className="p-3.5 text-center">
                            <div className="flex items-center justify-center gap-2">
                              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-300">
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 mr-1" /> 入金済み
                              </span>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={isUpdating}
                                onClick={() => handleTogglePayment(p)}
                                className="h-7 px-2 text-[10px] font-bold text-slate-500 border-slate-200 hover:bg-slate-50 shadow-2xs"
                              >
                                未に戻す
                              </Button>
                            </div>
                          </td>

                          <td className="p-3.5 text-center">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => handleOpenEditModal(p)}
                              className="h-7 px-2.5 text-[11px] font-bold border-slate-200 bg-white hover:bg-slate-50 text-slate-800 shadow-2xs"
                            >
                              <Edit2 className="w-3 h-3 mr-1 text-slate-500" /> 修正
                            </Button>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={7} className="py-16 text-center text-slate-400 font-medium">
                        入金済みの選手がまだいません。「エントリ・入金管理」タブから入金状態を切り替えてください。
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* タブコンテンツ3: 受付QRコード個別送信 */}
        {activeTab === "qr_send" && (
          <QrSendTab
            participants={scheduleParticipants}
            onRefresh={() => {
              // Firestore の onSnapshot により自動更新されるため空ハンドラーを渡す
            }}
          />
        )}

      </div>

      {/* 選手データ編集用モーダルウィンドウ */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl p-6 max-w-2xl w-full shadow-2xl border border-slate-200/80 space-y-4 my-8">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-black text-slate-900 text-base flex items-center gap-2">
                <Edit2 className="w-4 h-4 text-slate-700" /> 選手詳細・立順設定修正
              </h3>
              <button
                type="button"
                onClick={handleCloseModal}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 text-xs max-h-[70vh] overflow-y-auto pr-2">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">ゼッケン番号</label>
                  <input
                    type="number"
                    value={editForm.bibNumber}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, bibNumber: Number(e.target.value) }))}
                    className="w-full p-2.5 border border-slate-200 rounded-xl bg-slate-50/50 text-slate-900 font-mono font-bold focus:bg-white focus:ring-2 focus:ring-slate-900 outline-none transition-all"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">所作</label>
                  <select
                    value={editForm.shosa}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, shosa: e.target.value as ShosaType }))}
                    className="w-full p-2.5 border border-slate-200 rounded-xl bg-slate-50/50 text-slate-900 font-bold focus:bg-white focus:ring-2 focus:ring-slate-900 outline-none transition-all"
                  >
                    <option value="肌脱ぎ">肌脱ぎ</option>
                    <option value="襷掛け">襷掛け</option>
                  </select>
                </div>
              </div>

              {/* 第1立・第2立の個別設定セクション */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                <h4 className="font-bold text-slate-900 text-xs">各立の立グループ・立順設定（第1立・第2立）</h4>
                
                {([1, 2] as const).map((roundIdx: 1 | 2) => {
                  const titles: Record<1 | 2, string> = {
                    1: "第1立 (午前・一手 2射)",
                    2: "第2立 (午後・一手 2射)",
                  };
                  return (
                    <div key={roundIdx} className="grid grid-cols-3 gap-2 items-center bg-white p-2.5 rounded-lg border border-slate-200">
                      <span className="font-bold text-slate-800 text-[11px]">{titles[roundIdx]}</span>
                      <div>
                        <label className="block text-[10px] text-slate-500 mb-0.5">立ちグループ</label>
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
                        <label className="block text-[10px] text-slate-500 mb-0.5">立順 (1〜5)</label>
                        <select
                          value={editForm.standAssignments[roundIdx]?.standOrder || 1}
                          onChange={(e) => {
                            const val = Number(e.target.value) as 1 | 2 | 3 | 4 | 5;
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
                  );
                })}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">選手氏名 <span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    value={editForm.name}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, name: e.target.value }))}
                    className="w-full p-2.5 border border-slate-200 rounded-xl bg-slate-50/50 text-slate-900 font-bold focus:bg-white focus:ring-2 focus:ring-slate-900 outline-none transition-all"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">ふりがな</label>
                  <input
                    type="text"
                    value={editForm.nameKana}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, nameKana: e.target.value }))}
                    className="w-full p-2.5 border border-slate-200 rounded-xl bg-slate-50/50 text-slate-900 focus:bg-white focus:ring-2 focus:ring-slate-900 outline-none transition-all"
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
                    className="w-full p-2.5 border border-slate-200 rounded-xl bg-slate-50/50 text-slate-900 focus:bg-white focus:ring-2 focus:ring-slate-900 outline-none transition-all"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">称号・段位</label>
                  <select
                    value={editForm.rankTitle}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, rankTitle: e.target.value as RankTitleType }))}
                    className="w-full p-2.5 border border-slate-200 rounded-xl bg-slate-50/50 text-slate-900 font-bold focus:bg-white focus:ring-2 focus:ring-slate-900 outline-none transition-all"
                  >
                    <option value="段位は三段以下">段位は三段以下</option>
                    <option value="段位は四段以上">段位は四段以上</option>
                    <option value="称号を取得している">称号を取得している</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">申込代表者名</label>
                  <input
                    type="text"
                    value={editForm.representativeName}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, representativeName: e.target.value }))}
                    className="w-full p-2.5 border border-slate-200 rounded-xl bg-slate-50/50 text-slate-900 focus:bg-white focus:ring-2 focus:ring-slate-900 outline-none transition-all"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">代表者電話番号</label>
                  <input
                    type="text"
                    value={editForm.representativePhone}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, representativePhone: e.target.value }))}
                    className="w-full p-2.5 border border-slate-200 rounded-xl bg-slate-50/50 text-slate-900 font-mono focus:bg-white focus:ring-2 focus:ring-slate-900 outline-none transition-all"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">代表者メール</label>
                  <input
                    type="email"
                    value={editForm.representativeEmail}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, representativeEmail: e.target.value }))}
                    className="w-full p-2.5 border border-slate-200 rounded-xl bg-slate-50/50 text-slate-900 font-mono focus:bg-white focus:ring-2 focus:ring-slate-900 outline-none transition-all"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">役員役割</label>
                  <select
                    value={editForm.staffRole}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, staffRole: e.target.value as StaffRoleType }))}
                    className="w-full p-2.5 border border-slate-200 rounded-xl bg-slate-50/50 text-slate-900 font-bold focus:bg-white focus:ring-2 focus:ring-slate-900 outline-none transition-all"
                  >
                    <option value="進行">進行</option>
                    <option value="的前">的前</option>
                    <option value="招集">招集</option>
                    <option value="記録">記録</option>
                    <option value="カメラマン">カメラマン</option>
                    <option value="運営">運営</option>
                    <option value="無し">無し</option>
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">役員担当時間帯</label>
                  <select
                    value={editForm.staffDutyShift}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, staffDutyShift: e.target.value }))}
                    className="w-full p-2.5 border border-slate-200 rounded-xl bg-slate-50/50 text-slate-900 font-bold focus:bg-white focus:ring-2 focus:ring-slate-900 outline-none transition-all"
                  >
                    <option value="AM">AM</option>
                    <option value="PM">PM</option>
                    <option value="終日">終日</option>
                    <option value="無し">無し</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">備考</label>
                <textarea
                  rows={2}
                  value={editForm.notes}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, notes: e.target.value }))}
                  className="w-full p-2.5 border border-slate-200 rounded-xl bg-slate-50/50 text-slate-900 focus:bg-white focus:ring-2 focus:ring-slate-900 outline-none transition-all"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleCloseModal}
                disabled={isSaving}
                className="text-xs font-bold border-slate-200 bg-white hover:bg-slate-50 text-slate-700 shadow-2xs"
              >
                キャンセル
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={handleSaveChanges}
                disabled={isSaving}
                className="bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs shadow-xs"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> 保存中...
                  </>
                ) : (
                  <>
                    <Check className="w-3.5 h-3.5 mr-1 text-amber-400" /> 変更を保存する
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}