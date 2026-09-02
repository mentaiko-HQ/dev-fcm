"use client";

import React, { useState, useRef } from "react";
import { collection, doc, writeBatch, getDocs } from "firebase/firestore";
import { db, isFirebaseConfigured, isFirestoreAvailable } from "@/lib/firebase";
import { Participant } from "@/types/participant";
import { ShosaType, StaffRoleType, StandOrderType, RankTitleType } from "@/types";
import { Button } from "@/components/ui/button";
import {
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  Download,
  Users,
  ArrowRight
} from "lucide-react";

interface CSVImportScheduleWizardProps {
  matchId?: string;
}

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

export function CSVImportScheduleWizard({ matchId = "match_2026_mentaiko" }: CSVImportScheduleWizardProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [parsedParticipants, setParsedParticipants] = useState<Participant[]>([]);
  const [parseErrors, setParseErrors] = useState<Array<{ line: number; error: string }>>([]);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<{ type: "success" | "error" | "info"; text: string } | null>(null);

  const handleDownloadTemplate = () => {
    const headers = [
      "選手氏名",
      "ふりがな",
      "所属団体名",
      "所作",
      "称号段位",
      "役員協力希望",
      "サポート希望",
      "申込代表者名",
      "代表者電話番号",
      "代表者メールアドレス",
      "立ちグループ",
      "立順",
      "備考"
    ];

    const sampleRows = [
      ["早田 豊", "はやた ゆたか", "福岡弓道倶楽部", "肌脱ぎ", "称号を取得している", "希望", "不要", "早田 豊", "090-1234-5678", "hayata@example.com", "1", "1", "半日役員協力可能"],
      ["佐藤 健一", "さとう けんいち", "博多弓友会", "襷掛け", "段位は四段以上", "なし", "要サポート", "早田 豊", "090-1234-5678", "hayata@example.com", "1", "2", "本座での襷掛けサポート希望"],
      ["鈴木 一郎", "すずき いちろう", "無所属", "肌脱ぎ", "段位は三段以下", "なし", "不要", "鈴木 一郎", "090-9876-5432", "suzuki@example.com", "1", "3", "特記事項なし"]
    ];

    const csvContent = "\uFEFF" + [headers.join(","), ...sampleRows.map((r) => r.map((c) => `"${c}"`).join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", "mentaiko_cup_entry_template_with_samples.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      setFile(selectedFile);
      setParsedParticipants([]);
      setParseErrors([]);
      setStatusMessage(null);
      parseCSV(selectedFile);
    }
  };

  const parseCSV = async (csvFile: File) => {
    let existingCount = 0;
    try {
      if (isFirebaseConfigured && isFirestoreAvailable(db)) {
        const snap = await getDocs(collection(db, "entries"));
        existingCount = snap.size;
      }
    } catch (e) {
      console.warn("【警告】既存エントリー数取得失敗、1から採番します:", e);
    }

    const reader = new FileReader();

    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        if (!text) {
          setStatusMessage({ type: "error", text: "ファイルの内容が空です。" });
          return;
        }

        const lines = text.split(/\r\n|\n|\r/).filter((line) => line.trim().length > 0);
        if (lines.length < 2) {
          setStatusMessage({ type: "error", text: "CSVにデータ行が存在しません。" });
          return;
        }

        const headerTokens = lines[0].split(",").map((h) => h.replace(/^["']|["']$/g, "").trim());
        const getIdx = (candidates: string[]) => headerTokens.findIndex((h) => candidates.includes(h));

        const nameIdx = getIdx(["選手氏名", "名前", "氏名", "name"]);
        const kanaIdx = getIdx(["ふりがな", "よみがな", "フリガナ", "nameKana"]);
        const orgIdx = getIdx(["所属団体名", "所属", "organization"]);
        const shosaIdx = getIdx(["所作", "shosa"]);
        const rankIdx = getIdx(["称号段位", "称号・段位", "段位", "rankTitle"]);
        const volunteerIdx = getIdx(["役員協力希望", "役員希望", "isStaffVolunteer"]);
        const supportIdx = getIdx(["サポート希望", "サポート", "needsSupport"]);
        const repNameIdx = getIdx(["申込代表者名", "代表者名", "representativeName"]);
        const repPhoneIdx = getIdx(["代表者電話番号", "代表者電話", "representativePhone"]);
        const repEmailIdx = getIdx(["代表者メールアドレス", "代表者メール", "representativeEmail"]);
        const groupIdx = getIdx(["立ちグループ", "立グループ", "standGroup"]);
        const orderIdx = getIdx(["立順", "射順", "standOrder"]);
        const notesIdx = getIdx(["備考", "notes"]);

        if (nameIdx === -1) {
          setStatusMessage({ type: "error", text: "必須カラム「選手氏名」がヘッダーに見つかりません。" });
          return;
        }

        const participants: Participant[] = [];
        const errors: Array<{ line: number; error: string }> = [];

        for (let i = 1; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;

          const tokens = (line.match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g) || line.split(","))
            .map((t) => t.replace(/^["']|["']$/g, "").trim());

          const name = tokens[nameIdx] || "";
          if (!name) {
            errors.push({ line: i + 1, error: "選手氏名が未入力です。" });
            continue;
          }

          const kana = (kanaIdx !== -1 ? tokens[kanaIdx] : "") || name;
          const org = (orgIdx !== -1 ? tokens[orgIdx] : "") || "無所属";
          const shosaRaw = shosaIdx !== -1 ? tokens[shosaIdx] : "肌脱ぎ";
          const rankRaw = rankIdx !== -1 ? tokens[rankIdx] : "段位は三段以下";
          const volRaw = volunteerIdx !== -1 ? tokens[volunteerIdx] : "";
          const supRaw = supportIdx !== -1 ? tokens[supportIdx] : "";
          const repName = (repNameIdx !== -1 ? tokens[repNameIdx] : "") || name;
          const repPhone = repPhoneIdx !== -1 ? tokens[repPhoneIdx] : "";
          const repEmail = repEmailIdx !== -1 ? tokens[repEmailIdx] : "";
          const groupRaw = groupIdx !== -1 ? tokens[groupIdx] : "";
          const orderRaw = orderIdx !== -1 ? tokens[orderIdx] : "";
          const notes = notesIdx !== -1 ? tokens[notesIdx] : "";

          const isVolunteer = ["true", "1", "有", "有り", "希望", "希望あり", "yes"].includes(volRaw.toLowerCase());
          const needsSupport = ["true", "1", "要", "要サポート", "希望", "yes"].includes(supRaw.toLowerCase());

          const bibNumber = existingCount + i;
          const standGroup = groupRaw && !isNaN(Number(groupRaw)) ? Number(groupRaw) : Math.floor((i - 1) / 3) + 1;
          const rawOrder = orderRaw && !isNaN(Number(orderRaw)) ? Number(orderRaw) : ((i - 1) % 3) + 1;
          const standOrder = sanitizeStandOrder(rawOrder);

          participants.push({
            id: `player_${bibNumber}`,
            bibNumber,
            name,
            nameKana: kana,
            organization: org,
            shosa: sanitizeShosa(shosaRaw),
            rankTitle: sanitizeRankTitle(rankRaw),
            staffRole: isVolunteer ? "運営" : "無し",
            staffDutyShift: isVolunteer ? "AM" : "無し",
            checkInStatus: "UNCHECKED",
            isStaffVolunteer: isVolunteer,
            needsSupport,
            standGroup,
            standOrder,
            progressStatus: "WAITING",
            qualificationStatus: "ACTIVE",
            stand1_arrows: [],
            stand2_arrows: [],
            stand3_arrows: [],
            totalHits: 0,
            totalShots: 0,
            isPerfect: false,
            enkinRank: null,
            finalRank: null,
            representativeName: repName,
            representativePhone: repPhone,
            representativeEmail: repEmail,
            notes,
            agreedAt: Date.now(),
            updatedAt: Date.now(),
          });
        }

        setParsedParticipants(participants);
        setParseErrors(errors);

        if (errors.length > 0) {
          setStatusMessage({
            type: "info",
            text: `解析完了: 正常データ ${participants.length} 件、エラー行 ${errors.length} 件を検出しました。`
          });
        } else {
          setStatusMessage({
            type: "success",
            text: `正常に ${participants.length} 名の選手データを解析しました（ゼッケンは自動連番採番されます）。`
          });
        }
      } catch (err: unknown) {
        console.error("【エラーログ】CSV解析例外:", err);
        setStatusMessage({ type: "error", text: "CSVファイルの解析に失敗しました。" });
      }
    };

    reader.readAsText(csvFile, "utf-8");
  };

  const handleCommitImport = async () => {
    if (parsedParticipants.length === 0) return;

    setIsUploading(true);
    setStatusMessage({ type: "info", text: "Firestoreへ名簿データを書き込み中..." });

    try {
      if (isFirebaseConfigured && isFirestoreAvailable(db)) {
        const firestoreInstance = db;
        const CHUNK_SIZE = 400;

        for (let i = 0; i < parsedParticipants.length; i += CHUNK_SIZE) {
          const chunk = parsedParticipants.slice(i, i + CHUNK_SIZE);
          const batch = writeBatch(firestoreInstance);

          chunk.forEach((participant) => {
            const docRef = doc(firestoreInstance, "entries", participant.id);
            batch.set(docRef, participant);
          });

          await batch.commit();
        }
      }

      setStatusMessage({
        type: "success",
        text: `【一括登録完了】全 ${parsedParticipants.length} 名の選手名簿が正常に登録されました。`
      });
      setFile(null);
      setParsedParticipants([]);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err: unknown) {
      console.error("【エラーログ】名簿一括書き込み失敗:", err);
      setStatusMessage({ type: "error", text: "データベースへの書き込みに失敗しました。" });
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="w-full bg-slate-900 border border-slate-800 rounded-lg p-5 shadow-sm space-y-4 text-slate-100">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-slate-800 pb-3 gap-2">
        <div>
          <h3 className="font-bold text-slate-100 text-base flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-amber-500" />
            名簿CSV一括インポート ＆ 立ちグループ編成ウィザード
          </h3>
          <p className="text-xs text-slate-400">
            ゼッケン番号不要（自動連番採番）で選手名簿を一括インポートします
          </p>
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleDownloadTemplate}
          className="text-xs font-bold h-8 border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700"
        >
          <Download className="w-3.5 h-3.5 mr-1 text-amber-400" />
          入力例付きCSVテンプレート取得
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row items-center gap-3 p-4 bg-slate-950 border-2 border-dashed border-slate-800 rounded-lg">
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          onChange={handleFileChange}
          className="hidden"
          id="csv-file-input"
        />
        <label
          htmlFor="csv-file-input"
          className="cursor-pointer flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-100 rounded-md text-xs font-bold shadow transition-colors border border-slate-700"
        >
          <Upload className="w-4 h-4 text-amber-400" />
          CSVファイルを選択
        </label>
        <span className="text-xs text-slate-400 truncate">
          {file ? file.name : "選択されていません（UTF-8 / Shift_JIS対応）"}
        </span>
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

      {parseErrors.length > 0 && (
        <div className="p-3 bg-red-950/50 border border-red-800 rounded text-xs space-y-1">
          <p className="font-bold text-red-300">以下の行でエラーが検出されたためスキップされます:</p>
          <ul className="list-disc list-inside text-red-400 space-y-0.5 max-h-24 overflow-y-auto font-mono">
            {parseErrors.map((err, idx) => (
              <li key={idx}>行 {err.line}: {err.error}</li>
            ))}
          </ul>
        </div>
      )}

      {parsedParticipants.length > 0 && (
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-xs font-bold text-slate-200">
              インポート予定選手プレビュー ({parsedParticipants.length} 名)
            </span>
            <Button
              type="button"
              onClick={handleCommitImport}
              disabled={isUploading}
              className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-xs h-8 shadow active:scale-98 transition-transform"
            >
              {isUploading ? "書き込み中..." : "名簿データを確定して一括登録"}
              <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
            </Button>
          </div>

          <div className="border border-slate-800 rounded-md overflow-hidden max-h-60 overflow-y-auto bg-slate-950">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-900 text-slate-300 font-bold sticky top-0 border-b border-slate-800">
                <tr>
                  <th className="p-2">自動採番ゼッケン</th>
                  <th className="p-2">立 / 順</th>
                  <th className="p-2">選手氏名</th>
                  <th className="p-2">所属団体</th>
                  <th className="p-2">所作</th>
                  <th className="p-2">称号・段位</th>
                  <th className="p-2">役員希望</th>
                  <th className="p-2">サポート</th>
                  <th className="p-2">申込代表者</th>
                  <th className="p-2">備考</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {parsedParticipants.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-900/50">
                    <td className="p-2 font-mono font-bold text-amber-400">No.{p.bibNumber}</td>
                    <td className="p-2 text-slate-300">第{String(p.standGroup).padStart(2, "0")}立 {p.standOrder}番</td>
                    <td className="p-2">
                      <div className="font-bold text-slate-100">{p.name}</div>
                      <div className="text-[10px] text-slate-400">{p.nameKana}</div>
                    </td>
                    <td className="p-2 text-slate-300">{p.organization}</td>
                    <td className="p-2">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${
                        p.shosa === "肌脱ぎ" ? "bg-slate-800 text-slate-200 border-slate-700" : "bg-purple-950 text-purple-200 border-purple-800"
                      }`}>
                        {p.shosa}
                      </span>
                    </td>
                    <td className="p-2">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${
                        p.rankTitle === "称号を取得している" ? "bg-amber-950 text-amber-200 border-amber-800" :
                        p.rankTitle === "段位は四段以上" ? "bg-blue-950 text-blue-200 border-blue-800" :
                        "bg-slate-800 text-slate-200 border-slate-700"
                      }`}>
                        {p.rankTitle}
                      </span>
                    </td>
                    <td className="p-2">
                      {p.isStaffVolunteer ? (
                        <span className="text-[10px] bg-emerald-950 text-emerald-300 border border-emerald-800 font-bold px-1.5 py-0.5 rounded">希望</span>
                      ) : (
                        <span className="text-slate-500">-</span>
                      )}
                    </td>
                    <td className="p-2">
                      {p.needsSupport ? (
                        <span className="text-[10px] bg-amber-950 text-amber-300 border border-amber-800 font-bold px-1.5 py-0.5 rounded">要</span>
                      ) : (
                        <span className="text-slate-500">-</span>
                      )}
                    </td>
                    <td className="p-2 text-slate-300">{p.representativeName || "-"}</td>
                    <td className="p-2 text-slate-400 truncate max-w-[120px]">{p.notes || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}