"use client";

import React, { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { collection, onSnapshot, query, orderBy, writeBatch, doc, getDocs } from "firebase/firestore";
import { db, isFirebaseConfigured, isFirestoreAvailable } from "@/lib/firebase";
import { Participant } from "@/types/participant";
import {
  StaffRoleType,
  StaffDutyShiftType,
  StandOrderType,
  ShosaType,
  RankTitleType,
  QualificationStatus,
  STAND_ORDER_LABELS
} from "@/types";
import { Button } from "@/components/ui/button";
import {
  Users,
  Save,
  ArrowLeft,
  Search,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  Filter,
  Trash2
} from "lucide-react";

/**
 * 【フールプルーフ & フェイルセーフ】立順(1〜5)の型バリデーションおよび安全側フォールバック
 */
function sanitizeStandOrder(val: unknown): StandOrderType {
  const num = typeof val === "number" ? val : Number(val);
  if (num === 1 || num === 2 || num === 3 || num === 4 || num === 5) {
    return num;
  }
  return 1;
}

/**
 * 【フールプルーフ & フェイルセーフ】所作（肌脱ぎ / 襷掛け）のバリデーション
 */
function sanitizeShosa(val: unknown): ShosaType {
  if (val === "襷掛け") return "襷掛け";
  return "肌脱ぎ";
}

/**
 * 【フールプルーフ & フェイルセーフ】称号・段位のバリデーション
 */
function sanitizeRankTitle(val: unknown): RankTitleType {
  if (val === "称号を取得している" || val === "段位は四段以上" || val === "段位は三段以下") {
    return val;
  }
  return "段位は三段以下";
}

/**
 * 【フールプルーフ & フェイルセーフ】役員役割のバリデーション
 */
function sanitizeStaffRole(val: unknown): StaffRoleType {
  const validRoles: StaffRoleType[] = ["進行", "的前", "招集", "記録", "カメラマン", "運営", "無し"];
  if (typeof val === "string" && validRoles.includes(val as StaffRoleType)) {
    return val as StaffRoleType;
  }
  return "無し";
}

/**
 * 【フールプルーフ & フェイルセーフ】役員担当時間帯のバリデーション
 */
function sanitizeStaffDutyShift(val: unknown): StaffDutyShiftType {
  const validShifts: StaffDutyShiftType[] = ["AM", "PM", "終日", "無し"];
  if (typeof val === "string" && validShifts.includes(val as StaffDutyShiftType)) {
    return val as StaffDutyShiftType;
  }
  return "無し";
}

/**
 * 【フールプルーフ & フェイルセーフ】出欠資格のバリデーション
 */
function sanitizeQualificationStatus(val: unknown): QualificationStatus {
  const validQuals: QualificationStatus[] = ["ACTIVE", "ABSENT", "WITHDRAWN", "DISQUALIFIED"];
  if (typeof val === "string" && validQuals.includes(val as QualificationStatus)) {
    return val as QualificationStatus;
  }
  return "ACTIVE";
}

export default function ParticipantsManagementPage() {
  const router = useRouter();

  // Firestoreから取得したオリジナルデータリスト
  const [originalList, setOriginalList] = useState<Participant[]>([]);
  // 画面上で即時編集可能なローカルデータリスト
  const [editableList, setEditableList] = useState<Participant[]>([]);
  // 変更検知フラグマップ（ID -> boolean）
  const [modifiedIds, setModifiedIds] = useState<Set<string>>(new Set());

  // 検索・フィルタリング用ステート
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [filterGroup, setFilterGroup] = useState<string>("ALL");
  const [filterRank, setFilterRank] = useState<string>("ALL");
  const [filterRole, setFilterRole] = useState<string>("ALL");
  const [filterShift, setFilterShift] = useState<string>("ALL");

  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<{ type: "success" | "error" | "info"; text: string } | null>(null);

  // 【フールプルーフ】一括削除モーダルの表示状態および確認入力用ステート
  const [showDeleteModal, setShowDeleteModal] = useState<boolean>(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState<string>("");
  const [isDeletingAll, setIsDeletingAll] = useState<boolean>(false);

  // 【フェイルセーフ】Firestoreからのリアルタイム購読と例外ハンドリング
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
              staffDutyShift: sanitizeStaffDutyShift(raw.staffDutyShift || (raw.isStaffVolunteer ? "AM" : "無し")),
              isStaffVolunteer: Boolean(raw.isStaffVolunteer),
              needsSupport: Boolean(raw.needsSupport),
              standGroup: typeof raw.standGroup === "number" ? raw.standGroup : Number(raw.standGroup) || 1,
              standOrder: sanitizeStandOrder(raw.standOrder),
              progressStatus: raw.progressStatus || "WAITING",
              qualificationStatus: sanitizeQualificationStatus(raw.qualificationStatus),
              stand1_arrows: Array.isArray(raw.stand1_arrows) ? raw.stand1_arrows : [],
              stand2_arrows: Array.isArray(raw.stand2_arrows) ? raw.stand2_arrows : [],
              stand3_arrows: Array.isArray(raw.stand3_arrows) ? raw.stand3_arrows : [],
              totalHits: typeof raw.totalHits === "number" ? raw.totalHits : 0,
              totalShots: typeof raw.totalShots === "number" ? raw.totalShots : 0,
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

          setOriginalList(loaded);
          setModifiedIds((prevModified) => {
            if (prevModified.size === 0) {
              setEditableList(loaded);
            }
            return prevModified;
          });
        } else {
          setOriginalList([]);
          setEditableList([]);
        }
      },
      (error: unknown) => {
        console.error("【エラーログ】選手一覧購読失敗:", error);
        setStatusMessage({ type: "error", text: "選手データの同期に失敗しました。" });
      }
    );

    return () => unsubscribe();
  }, []);

  // 【フールプルーフ】編集フィールド変更ハンドラ
  const handleFieldChange = (
    id: string,
    field: keyof Pick<Participant, "bibNumber" | "name" | "nameKana" | "organization" | "standGroup" | "standOrder" | "staffRole" | "staffDutyShift" | "rankTitle">,
    value: unknown
  ) => {
    setEditableList((prevList) =>
      prevList.map((p) => {
        if (p.id !== id) return p;

        const updated: Participant = { ...p };

        if (field === "bibNumber") {
          const num = Number(value);
          updated.bibNumber = isNaN(num) || num < 1 ? 1 : Math.floor(num);
        } else if (field === "name") {
          updated.name = String(value);
        } else if (field === "nameKana") {
          updated.nameKana = String(value);
        } else if (field === "organization") {
          updated.organization = String(value);
        } else if (field === "standGroup") {
          const groupNum = Number(value);
          updated.standGroup = isNaN(groupNum) || groupNum < 1 ? 1 : Math.min(99, Math.floor(groupNum));
        } else if (field === "standOrder") {
          updated.standOrder = sanitizeStandOrder(value);
        } else if (field === "rankTitle") {
          updated.rankTitle = sanitizeRankTitle(value);
        } else if (field === "staffRole") {
          const role = sanitizeStaffRole(value);
          updated.staffRole = role;
          if (role === "無し") {
            updated.staffDutyShift = "無し";
          } else if (updated.staffDutyShift === "無し") {
            updated.staffDutyShift = "AM";
          }
        } else if (field === "staffDutyShift") {
          const shift = sanitizeStaffDutyShift(value);
          updated.staffDutyShift = shift;
          if (shift === "無し") {
            updated.staffRole = "無し";
          } else if (updated.staffRole === "無し") {
            updated.staffRole = "運営";
          }
        }

        return updated;
      })
    );

    setModifiedIds((prev) => new Set(prev).add(id));
    setStatusMessage(null);
  };

  const handleResetRow = (id: string) => {
    const original = originalList.find((p) => p.id === id);
    if (!original) return;

    setEditableList((prev) => prev.map((p) => (p.id === id ? { ...original } : p)));
    setModifiedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const handleDiscardAll = () => {
    setEditableList([...originalList]);
    setModifiedIds(new Set());
    setStatusMessage({ type: "info", text: "すべての変更を破棄し、保存済みの状態に戻しました。" });
  };

  // 【フェイルセーフ ＆ フールプルーフ】一括保存処理
  const handleSaveAllChanges = async () => {
    if (modifiedIds.size === 0) return;

    const bibSet = new Set<number>();
    for (const p of editableList) {
      if (!p.name.trim()) {
        setStatusMessage({ type: "error", text: "【入力エラー】選手氏名が空欄のレコードがあります。" });
        return;
      }
      if (bibSet.has(p.bibNumber)) {
        setStatusMessage({
          type: "error",
          text: `【入力エラー】ゼッケン番号 No.${p.bibNumber} が重複しています。各選手固有の番号を設定してください。`
        });
        return;
      }
      bibSet.add(p.bibNumber);
    }

    setIsSaving(true);
    setStatusMessage({ type: "info", text: "変更内容をデータベースに保存中..." });

    try {
      if (isFirebaseConfigured && isFirestoreAvailable(db)) {
        const firestoreInstance = db;
        const targets = editableList.filter((p) => modifiedIds.has(p.id));

        const CHUNK_SIZE = 400;
        for (let i = 0; i < targets.length; i += CHUNK_SIZE) {
          const chunk = targets.slice(i, i + CHUNK_SIZE);
          const batch = writeBatch(firestoreInstance);

          chunk.forEach((p) => {
            const docRef = doc(firestoreInstance, "entries", p.id);
            batch.update(docRef, {
              bibNumber: p.bibNumber,
              name: p.name.trim(),
              nameKana: p.nameKana.trim(),
              organization: p.organization.trim(),
              standGroup: p.standGroup,
              standOrder: p.standOrder,
              staffRole: p.staffRole,
              staffDutyShift: p.staffDutyShift || "無し",
              rankTitle: p.rankTitle,
              isStaffVolunteer: p.staffRole !== "無し",
              updatedAt: Date.now(),
            });
          });

          await batch.commit();
        }
      }

      setModifiedIds(new Set());
      setStatusMessage({
        type: "success",
        text: `【保存完了】${modifiedIds.size} 名の選手情報を正常に更新しました。`
      });
    } catch (err: unknown) {
      console.error("【エラーログ】選手設定一括保存失敗:", err);
      setStatusMessage({
        type: "error",
        text: "データベースへの保存中にエラーが発生しました。通信環境を確認してください。"
      });
    } finally {
      setIsSaving(false);
    }
  };

  // 【フェイルセーフ ＆ フールプルーフ】参加選手データ全件一括削除処理（400件チャンク分割バッチ）
  const handleExecuteDeleteAll = async () => {
    if (deleteConfirmText !== "全削除実行") {
      setStatusMessage({ type: "error", text: "確認用の文字列「全削除実行」が一致しません。" });
      return;
    }

    setIsDeletingAll(true);
    setStatusMessage({ type: "info", text: "全選手データを削除中..." });

    try {
      if (isFirebaseConfigured && isFirestoreAvailable(db)) {
        const firestoreInstance = db;
        const snap = await getDocs(collection(firestoreInstance, "entries"));
        const docsToDelete = snap.docs;

        const CHUNK_SIZE = 400;
        for (let i = 0; i < docsToDelete.length; i += CHUNK_SIZE) {
          const chunk = docsToDelete.slice(i, i + CHUNK_SIZE);
          const batch = writeBatch(firestoreInstance);
          chunk.forEach((d) => {
            batch.delete(d.ref);
          });
          await batch.commit();
        }
      }

      setShowDeleteModal(false);
      setDeleteConfirmText("");
      setEditableList([]);
      setOriginalList([]);
      setModifiedIds(new Set());
      setStatusMessage({ type: "success", text: "【削除完了】すべての参加選手データが正常に削除されました。" });
    } catch (err: unknown) {
      console.error("【エラーログ】全選手データ一括削除失敗:", err);
      setStatusMessage({ type: "error", text: "選手データの削除処理に失敗しました。通信環境を確認してください。" });
    } finally {
      setIsDeletingAll(false);
    }
  };

  const filteredList = useMemo(() => {
    return editableList.filter((item) => {
      if (filterGroup !== "ALL" && String(item.standGroup) !== filterGroup) return false;
      if (filterRank !== "ALL" && item.rankTitle !== filterRank) return false;
      if (filterRole !== "ALL" && item.staffRole !== filterRole) return false;
      if (filterShift !== "ALL" && (item.staffDutyShift || "無し") !== filterShift) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = item.name.toLowerCase().includes(q);
        const matchesKana = item.nameKana.toLowerCase().includes(q);
        const matchesOrg = item.organization.toLowerCase().includes(q);
        const matchesBib = String(item.bibNumber).includes(q);
        const matchesRep = (item.representativeName || "").toLowerCase().includes(q);
        if (!matchesName && !matchesKana && !matchesOrg && !matchesBib && !matchesRep) return false;
      }

      return true;
    });
  }, [editableList, filterGroup, filterRank, filterRole, filterShift, searchQuery]);

  const availableGroups = useMemo(() => {
    const groups = Array.from(new Set(editableList.map((p) => p.standGroup))).sort((a, b) => a - b);
    return groups;
  }, [editableList]);

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-4 md:p-8 flex flex-col items-center gap-6">
      <div className="w-full max-w-7xl bg-slate-900 border border-slate-800 rounded-lg shadow-sm p-6 md:p-8 space-y-6 mx-auto">
        
        {/* ヘッダーエリア */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-slate-800 pb-4 gap-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-bold bg-amber-500 text-slate-950 px-2 py-0.5 rounded">
                運営本部専用
              </span>
              <span className="text-xs bg-slate-800 text-slate-300 font-bold px-2 py-0.5 rounded border border-slate-700">
                選手情報 ＆ 立順・役員編成管理
              </span>
            </div>
            <h1 className="text-xl md:text-2xl font-black text-white flex items-center gap-2">
              <Users className="w-6 h-6 text-amber-400" />
              参加選手一覧 ＆ 氏名・ゼッケン・立順・称号段位・役員編集
            </h1>
            <p className="text-xs text-slate-400 mt-0.5">
              全登録選手の「氏名」「ふりがな」「所属団体」「ゼッケン番号」「立グループ」「立順」「称号・段位」「役員設定」を即時編集できます
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => router.push("/admin")}
              className="text-xs font-bold border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200"
            >
              <ArrowLeft className="w-3.5 h-3.5 mr-1" />
              管理トップへ戻る
            </Button>

            {/* 【フールプルーフ】全件一括削除ボタン（危険な操作のため赤色で明確に分離） */}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setDeleteConfirmText("");
                setShowDeleteModal(true);
              }}
              className="text-xs font-bold border-red-800 bg-red-950/60 hover:bg-red-900 text-red-200"
            >
              <Trash2 className="w-3.5 h-3.5 mr-1 text-red-400" />
              参加選手を一括削除
            </Button>

            <Button
              type="button"
              onClick={handleSaveAllChanges}
              disabled={modifiedIds.size === 0 || isSaving}
              className={`text-xs font-black h-9 px-4 shadow ${
                modifiedIds.size > 0
                  ? "bg-red-600 hover:bg-red-700 text-white animate-pulse"
                  : "bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700"
              }`}
            >
              <Save className="w-4 h-4 mr-1.5" />
              {isSaving ? "保存中..." : `変更を保存 (${modifiedIds.size} 件)`}
            </Button>
          </div>
        </div>

        {/* 検索・フィルターバー */}
        <div className="p-4 bg-slate-950 border border-slate-800 rounded-lg space-y-3">
          <div className="flex flex-col md:flex-row gap-3 justify-between items-stretch md:items-center">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input
                type="text"
                placeholder="ゼッケン・氏名・所属・代表者名で絞り込み..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 pr-4 py-2 w-full text-xs md:text-sm border border-slate-700 rounded-md bg-slate-900 text-slate-100 focus:ring-2 focus:ring-amber-500 focus:outline-none placeholder:text-slate-500"
              />
            </div>

            {modifiedIds.size > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-amber-300 bg-amber-950/80 border border-amber-800 px-2.5 py-1 rounded">
                  未保存の変更が {modifiedIds.size} 件あります
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleDiscardAll}
                  className="text-xs text-slate-300 hover:text-white border-slate-700 bg-slate-800 h-8"
                >
                  <RotateCcw className="w-3.5 h-3.5 mr-1" />
                  破棄
                </Button>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs pt-1 border-t border-slate-800">
            <div className="flex items-center gap-1 font-bold text-slate-300">
              <Filter className="w-3.5 h-3.5 text-amber-400" />
              <span>フィルター:</span>
            </div>

            <div className="flex items-center gap-1">
              <label className="text-slate-400">立グループ:</label>
              <select
                value={filterGroup}
                onChange={(e) => setFilterGroup(e.target.value)}
                className="p-1.5 border border-slate-700 rounded bg-slate-900 text-slate-200 font-bold focus:ring-2 focus:ring-amber-500"
              >
                <option value="ALL">全グループ ({editableList.length})</option>
                {availableGroups.map((g) => (
                  <option key={g} value={String(g)}>
                    第 {String(g).padStart(2, "0")} 立
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-1">
              <label className="text-slate-400">称号・段位:</label>
              <select
                value={filterRank}
                onChange={(e) => setFilterRank(e.target.value)}
                className="p-1.5 border border-slate-700 rounded bg-slate-900 text-slate-200 font-bold focus:ring-2 focus:ring-amber-500"
              >
                <option value="ALL">全称号・段位</option>
                <option value="段位は三段以下">段位は三段以下</option>
                <option value="段位は四段以上">段位は四段以上</option>
                <option value="称号を取得している">称号を取得している</option>
              </select>
            </div>

            <div className="flex items-center gap-1">
              <label className="text-slate-400">役員種類:</label>
              <select
                value={filterRole}
                onChange={(e) => setFilterRole(e.target.value)}
                className="p-1.5 border border-slate-700 rounded bg-slate-900 text-slate-200 font-bold focus:ring-2 focus:ring-amber-500"
              >
                <option value="ALL">全役員種類</option>
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
              <label className="text-slate-400">時間帯:</label>
              <select
                value={filterShift}
                onChange={(e) => setFilterShift(e.target.value)}
                className="p-1.5 border border-slate-700 rounded bg-slate-900 text-slate-200 font-bold focus:ring-2 focus:ring-amber-500"
              >
                <option value="ALL">全時間帯</option>
                <option value="AM">午前 (AM)</option>
                <option value="PM">午後 (PM)</option>
                <option value="終日">終日</option>
                <option value="無し">無し</option>
              </select>
            </div>
          </div>
        </div>

        {statusMessage && (
          <div className={`p-3 rounded text-xs font-bold border flex items-center gap-2 ${
            statusMessage.type === "success"
              ? "bg-emerald-950/80 border-emerald-800 text-emerald-200"
              : statusMessage.type === "error"
              ? "bg-red-950/80 border-red-800 text-red-200"
              : "bg-blue-950/80 border-blue-800 text-blue-200"
          }`}>
            {statusMessage.type === "success" ? (
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
            ) : statusMessage.type === "error" ? (
              <AlertTriangle className="w-4 h-4 shrink-0 text-red-400" />
            ) : (
              <Users className="w-4 h-4 shrink-0 text-blue-400" />
            )}
            <span>{statusMessage.text}</span>
          </div>
        )}

        {/* 編集用テーブル */}
        <div className="border border-slate-800 rounded-md overflow-x-auto bg-slate-950 shadow-2xs">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-900 text-slate-300 font-bold border-b border-slate-800">
              <tr>
                <th className="p-2.5 w-16 text-center">状態</th>
                <th className="p-2.5 w-24">ゼッケン</th>
                <th className="p-2.5 w-28">立グループ</th>
                <th className="p-2.5 w-28">立順 (呼称)</th>
                <th className="p-2.5 w-48">選手氏名</th>
                <th className="p-2.5 w-48">ふりがな</th>
                <th className="p-2.5 w-40">所属団体</th>
                <th className="p-2.5 w-36">称号・段位</th>
                <th className="p-2.5 w-32">役員種類</th>
                <th className="p-2.5 w-28">時間帯</th>
                <th className="p-2.5 w-16 text-center">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {filteredList.length > 0 ? (
                filteredList.map((p) => {
                  const isModified = modifiedIds.has(p.id);

                  return (
                    <tr
                      key={p.id}
                      className={`hover:bg-slate-900/50 transition-colors ${
                        isModified ? "bg-amber-950/30" : ""
                      }`}
                    >
                      <td className="p-2.5 text-center">
                        {isModified ? (
                          <span className="inline-block w-2.5 h-2.5 rounded-full bg-amber-500 animate-ping" title="未保存の変更" />
                        ) : (
                          <span className="text-slate-600">-</span>
                        )}
                      </td>

                      {/* ゼッケン番号編集 */}
                      <td className="p-2">
                        <div className="flex items-center gap-1 font-mono">
                          <span className="text-slate-500 font-bold">No.</span>
                          <input
                            type="number"
                            min={1}
                            max={9999}
                            value={p.bibNumber}
                            onChange={(e) => handleFieldChange(p.id, "bibNumber", e.target.value)}
                            className="w-16 p-1 text-xs font-bold border border-slate-700 rounded bg-slate-900 text-amber-400 text-center focus:ring-2 focus:ring-amber-500 focus:outline-none"
                          />
                        </div>
                      </td>

                      {/* 立ちグループ編集 */}
                      <td className="p-2">
                        <div className="flex items-center gap-1">
                          <span className="text-slate-400 font-medium">第</span>
                          <input
                            type="number"
                            min={1}
                            max={99}
                            value={p.standGroup}
                            onChange={(e) => handleFieldChange(p.id, "standGroup", e.target.value)}
                            className="w-12 p-1 text-xs font-bold border border-slate-700 rounded bg-slate-900 text-slate-100 text-center focus:ring-2 focus:ring-amber-500 focus:outline-none"
                          />
                          <span className="text-slate-400 font-medium">立</span>
                        </div>
                      </td>

                      {/* 立順セレクト（大前 / ２番 / 中 / 三番 / 落ち） */}
                      <td className="p-2">
                        <select
                          value={p.standOrder}
                          onChange={(e) => handleFieldChange(p.id, "standOrder", e.target.value)}
                          className="w-24 p-1 text-xs font-bold border border-slate-700 rounded bg-slate-900 text-amber-300 focus:ring-2 focus:ring-amber-500"
                        >
                          <option value={1}>{STAND_ORDER_LABELS[1]}</option>
                          <option value={2}>{STAND_ORDER_LABELS[2]}</option>
                          <option value={3}>{STAND_ORDER_LABELS[3]}</option>
                          <option value={4}>{STAND_ORDER_LABELS[4]}</option>
                          <option value={5}>{STAND_ORDER_LABELS[5]}</option>
                        </select>
                      </td>

                      {/* 選手氏名 編集 */}
                      <td className="p-2">
                        <input
                          type="text"
                          value={p.name}
                          onChange={(e) => handleFieldChange(p.id, "name", e.target.value)}
                          className="w-full p-1 text-xs font-bold border border-slate-700 rounded bg-slate-900 text-slate-100 focus:ring-2 focus:ring-amber-500 focus:outline-none"
                        />
                      </td>

                      {/* ふりがな 編集 */}
                      <td className="p-2">
                        <input
                          type="text"
                          value={p.nameKana}
                          onChange={(e) => handleFieldChange(p.id, "nameKana", e.target.value)}
                          className="w-full p-1 text-xs border border-slate-700 rounded bg-slate-900 text-slate-300 focus:ring-2 focus:ring-amber-500 focus:outline-none"
                        />
                      </td>

                      {/* 所属団体 編集 */}
                      <td className="p-2">
                        <input
                          type="text"
                          value={p.organization}
                          onChange={(e) => handleFieldChange(p.id, "organization", e.target.value)}
                          className="w-full p-1 text-xs border border-slate-700 rounded bg-slate-900 text-slate-300 focus:ring-2 focus:ring-amber-500 focus:outline-none"
                        />
                      </td>

                      {/* 称号・段位セレクト */}
                      <td className="p-2">
                        <select
                          value={p.rankTitle || "段位は三段以下"}
                          onChange={(e) => handleFieldChange(p.id, "rankTitle", e.target.value)}
                          className="w-full p-1 text-xs font-bold border border-slate-700 rounded bg-slate-900 text-slate-100 focus:ring-2 focus:ring-amber-500"
                        >
                          <option value="段位は三段以下">段位は三段以下</option>
                          <option value="段位は四段以上">段位は四段以上</option>
                          <option value="称号を取得している">称号を取得している</option>
                        </select>
                      </td>

                      {/* 役員種類セレクト */}
                      <td className="p-2">
                        <select
                          value={p.staffRole}
                          onChange={(e) => handleFieldChange(p.id, "staffRole", e.target.value)}
                          className={`w-full p-1 text-xs font-bold border rounded focus:ring-2 focus:ring-amber-500 ${
                            p.staffRole !== "無し"
                              ? "bg-amber-950/60 border-amber-700 text-amber-200"
                              : "bg-slate-900 border-slate-700 text-slate-300"
                          }`}
                        >
                          <option value="無し">無し(一般)</option>
                          <option value="進行">進行</option>
                          <option value="的前">的前</option>
                          <option value="招集">招集</option>
                          <option value="記録">記録</option>
                          <option value="カメラマン">カメラマン</option>
                          <option value="運営">運営統括</option>
                        </select>
                      </td>

                      {/* 担当時間帯セレクト */}
                      <td className="p-2">
                        <select
                          value={p.staffDutyShift || "無し"}
                          disabled={p.staffRole === "無し"}
                          onChange={(e) => handleFieldChange(p.id, "staffDutyShift", e.target.value)}
                          className={`w-full p-1 text-xs font-bold border rounded focus:ring-2 focus:ring-amber-500 disabled:opacity-30 disabled:bg-slate-900 ${
                            p.staffDutyShift === "AM"
                              ? "bg-blue-950/60 border-blue-700 text-blue-200"
                              : p.staffDutyShift === "PM"
                              ? "bg-orange-950/60 border-orange-700 text-orange-200"
                              : p.staffDutyShift === "終日"
                              ? "bg-emerald-950/60 border-emerald-700 text-emerald-200"
                              : "bg-slate-900 border-slate-700 text-slate-300"
                          }`}
                        >
                          <option value="無し">無し</option>
                          <option value="AM">午前(AM)</option>
                          <option value="PM">午後(PM)</option>
                          <option value="終日">終日</option>
                        </select>
                      </td>

                      <td className="p-2.5 text-center">
                        {isModified ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => handleResetRow(p.id)}
                            className="h-6 px-1.5 text-[10px] text-slate-400 hover:text-white hover:bg-slate-800"
                            title="この行の変更を元に戻す"
                          >
                            元に戻す
                          </Button>
                        ) : (
                          <span className="text-slate-600 text-xs">-</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={11} className="p-8 text-center text-slate-500 font-medium">
                    該当する参加選手が見つかりません。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col sm:flex-row justify-between items-center text-xs text-slate-400 pt-2 gap-3">
          <div>
            表示中: <strong className="text-white">{filteredList.length}</strong> / 全 <strong className="text-white">{editableList.length}</strong> 名
            {modifiedIds.size > 0 && (
              <span className="ml-2 text-amber-400 font-bold">（未保存: {modifiedIds.size} 件）</span>
            )}
          </div>

          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => router.push("/admin")}
              className="text-xs border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700"
            >
              本部管理トップへ
            </Button>
            <Button
              type="button"
              onClick={handleSaveAllChanges}
              disabled={modifiedIds.size === 0 || isSaving}
              className={`text-xs font-bold h-8 px-4 ${
                modifiedIds.size > 0 ? "bg-red-600 hover:bg-red-700 text-white" : "bg-slate-800 text-slate-500 border border-slate-700"
              }`}
            >
              <Save className="w-3.5 h-3.5 mr-1.5" />
              {isSaving ? "保存中..." : `確定して保存 (${modifiedIds.size} 件)`}
            </Button>
          </div>
        </div>

      </div>

      {/* 【フールプルーフ】全件一括削除の誤操作を防ぐための二重確認モーダル */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-slate-900 rounded-lg p-6 max-w-md w-full shadow-2xl border border-red-800 space-y-4">
            <div className="flex items-center gap-3 text-red-400">
              <AlertTriangle className="w-6 h-6 shrink-0" />
              <h4 className="font-bold text-white text-base">【危険】全選手データを一括削除しますか？</h4>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              この操作を実行すると、<strong>登録されているすべての参加選手データ（entriesコレクション）が完全に削除</strong>され、元に戻すことはできません。
            </p>
            <div className="space-y-2 pt-2">
              <label className="block text-xs font-bold text-slate-300">
                確認のため、下に <span className="text-red-400 font-mono">全削除実行</span> と入力してください:
              </label>
              <input
                type="text"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder="全削除実行"
                className="w-full p-2 text-xs border border-slate-700 rounded bg-slate-950 text-white font-mono focus:ring-2 focus:ring-red-500 focus:outline-none"
              />
            </div>
            <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowDeleteModal(false)}
                disabled={isDeletingAll}
                className="text-xs font-bold border-slate-700 bg-slate-800 text-slate-200"
              >
                キャンセル
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={handleExecuteDeleteAll}
                disabled={deleteConfirmText !== "全削除実行" || isDeletingAll}
                className="bg-red-600 hover:bg-red-700 text-white font-bold text-xs disabled:opacity-40"
              >
                {isDeletingAll ? "削除処理中..." : "データを完全に削除する"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}