"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { collection, doc, writeBatch, getDocs } from "firebase/firestore";
import { db, isFirebaseConfigured, isFirestoreAvailable } from "@/lib/firebase";
import { RepresentativeEntryFormData, EntryPlayerItem, ShosaType, RankTitleType } from "@/types";
import { Participant } from "@/types/participant";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  CheckCircle2,
  AlertCircle,
  CreditCard,
  UserPlus,
  Trash2,
  Users,
  Info,
  UserCheck,
  Mail,
  Phone,
  HelpCircle,
  Award
} from "lucide-react";

const ENTRY_FEE_PER_PERSON = 1500;

// フールプルーフ: 称号・段位の安全側サニタイズ
function sanitizeRankTitle(val: unknown): RankTitleType {
  if (val === "称号を取得している" || val === "段位は四段以上" || val === "段位は三段以下") {
    return val;
  }
  return "段位は三段以下";
}

export default function EntryFormPage() {
  const router = useRouter();

  // フールプルーフ: 要項同意フラグの検証（未同意アクセスの遮断）
  useEffect(() => {
    try {
      const agreed = sessionStorage.getItem("mentaiko_terms_agreed");
      if (agreed !== "true") {
        router.replace("/guidelines");
      }
    } catch {
      router.replace("/guidelines");
    }
  }, [router]);

  // 代表者情報および複数選手リストの状態管理（rankTitle を初期追加）
  const [formData, setFormData] = useState<RepresentativeEntryFormData>({
    representativeName: "",
    representativeEmail: "",
    representativePhone: "",
    representativeOrganization: "",
    players: [
      {
        name: "",
        nameKana: "",
        shosa: "肌脱ぎ",
        rankTitle: "段位は三段以下",
        needsSupport: false,
        isStaffVolunteer: false,
      },
    ],
    notes: "",
  });

  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isSuccess, setIsSuccess] = useState<boolean>(false);
  const [registeredPlayers, setRegisteredPlayers] = useState<Array<{ name: string; bibNumber: number }>>([]);
  const [errorMessage, setErrorMessage] = useState<string>("");

  const handleRepresentativeChange = (
    field: keyof Omit<RepresentativeEntryFormData, "players">,
    value: string
  ) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    setErrorMessage("");
  };

  const handleAddPlayer = () => {
    setFormData((prev) => ({
      ...prev,
      players: [
        ...prev.players,
        {
          name: "",
          nameKana: "",
          shosa: "肌脱ぎ",
          rankTitle: "段位は三段以下",
          needsSupport: false,
          isStaffVolunteer: false,
        },
      ],
    }));
  };

  const handleRemovePlayer = (index: number) => {
    if (formData.players.length <= 1) return;
    setFormData((prev) => ({
      ...prev,
      players: prev.players.filter((_, i) => i !== index),
    }));
  };

  const handlePlayerChange = (
    index: number,
    field: keyof EntryPlayerItem,
    value: unknown
  ) => {
    setFormData((prev) => {
      const updatedPlayers = [...prev.players];
      updatedPlayers[index] = {
        ...updatedPlayers[index],
        [field]: value,
      };
      return { ...prev, players: updatedPlayers };
    });
    setErrorMessage("");
  };

  const handleSubmitEntry = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.representativeName.trim()) {
      setErrorMessage("参加申し込み代表者のお名前を入力してください。");
      return;
    }
    if (!formData.representativeEmail.trim()) {
      setErrorMessage("代表者メールアドレスを入力してください。");
      return;
    }
    if (!formData.representativePhone.trim()) {
      setErrorMessage("代表者携帯電話番号を入力してください。");
      return;
    }

    for (let i = 0; i < formData.players.length; i++) {
      const player = formData.players[i];
      if (!player.name.trim()) {
        setErrorMessage(`選手 ${i + 1} の氏名を入力してください。`);
        return;
      }
      if (!player.nameKana.trim()) {
        setErrorMessage(`選手 ${i + 1} のふりがなを入力してください。`);
        return;
      }
    }

    setIsSubmitting(true);
    setErrorMessage("");

    try {
      const assignedList: Array<{ name: string; bibNumber: number }> = [];

      if (isFirebaseConfigured && isFirestoreAvailable(db)) {
        const firestoreInstance = db;
        const entriesSnap = await getDocs(collection(firestoreInstance, "entries"));
        let currentCount = entriesSnap.size;

        const batch = writeBatch(firestoreInstance);
        const now = Date.now();

        formData.players.forEach((player) => {
          currentCount += 1;
          const bibNumber = currentCount;
          const standGroup = Math.floor((currentCount - 1) / 3) + 1;
          const orderIndex = ((currentCount - 1) % 3) + 1;
          const standOrder = (orderIndex <= 5 ? orderIndex : 1) as 1 | 2 | 3 | 4 | 5;

          const newEntryId = `player_${bibNumber}`;
          const entryDocRef = doc(firestoreInstance, "entries", newEntryId);

          const newParticipant: Participant = {
            id: newEntryId,
            bibNumber,
            name: player.name.trim(),
            nameKana: player.nameKana.trim(),
            organization: formData.representativeOrganization.trim() || "無所属",
            shosa: player.shosa,
            rankTitle: sanitizeRankTitle(player.rankTitle),
            staffRole: player.isStaffVolunteer ? "運営" : "無し",
            staffDutyShift: player.isStaffVolunteer ? "AM" : "無し",
            isStaffVolunteer: player.isStaffVolunteer,
            needsSupport: player.needsSupport,
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
            representativeName: formData.representativeName.trim(),
            representativeEmail: formData.representativeEmail.trim(),
            representativePhone: formData.representativePhone.trim(),
            representativeOrganization: formData.representativeOrganization.trim(),
            notes: formData.notes.trim(),
            agreedAt: now,
            updatedAt: now,
          };

          batch.set(entryDocRef, newParticipant);
          assignedList.push({ name: player.name.trim(), bibNumber });
        });

        await batch.commit();
      } else {
        formData.players.forEach((player, idx) => {
          assignedList.push({ name: player.name.trim(), bibNumber: 100 + idx });
        });
      }

      setRegisteredPlayers(assignedList);
      setIsSuccess(true);
    } catch (err: unknown) {
      console.error("【エラーログ】一括エントリー送信失敗:", err);
      setErrorMessage("エントリー登録に失敗しました。通信環境をご確認の上、再度お試しください。");
    } finally {
      setIsSubmitting(false);
    }
  };

  const totalFee = formData.players.length * ENTRY_FEE_PER_PERSON;

  if (isSuccess) {
    return (
      <main className="min-h-screen bg-slate-100 p-4 md:p-8 flex flex-col items-center justify-center">
        <div className="w-full max-w-lg bg-white border border-slate-200 rounded-lg shadow-lg p-6 md:p-8 space-y-6">
          <div className="w-14 h-14 bg-emerald-100 text-emerald-700 rounded-full flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-9 h-9" />
          </div>

          <div className="text-center">
            <h2 className="text-xl font-black text-slate-900">エントリーを受け付けました</h2>
            <p className="text-xs text-slate-500 mt-1">
              第5回めんたいこ杯争奪弓道大会（代表者: {formData.representativeName} 様）
            </p>
          </div>

          <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
            <p className="text-xs font-bold text-slate-700 border-b border-slate-200 pb-1 flex items-center gap-1.5">
              <Users className="w-4 h-4 text-slate-600" />
              登録選手一覧（合計 {registeredPlayers.length} 名）
            </p>
            <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
              {registeredPlayers.map((p) => (
                <div
                  key={p.bibNumber}
                  className="flex justify-between items-center bg-white p-2.5 rounded border border-slate-200 text-xs"
                >
                  <span className="font-bold text-slate-900">{p.name} 様</span>
                  <span className="font-mono font-black text-slate-900 bg-slate-100 px-2 py-0.5 rounded">
                    仮No. {p.bibNumber}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-950 space-y-2">
            <p className="font-bold flex items-center gap-1.5 text-amber-900 text-sm">
              <CreditCard className="w-4 h-4" /> PayPay送金のお願い（参加確定手順）
            </p>
            <p className="leading-relaxed">
              合計参加費 <strong className="text-base text-red-600 font-black">{totalFee.toLocaleString()} 円</strong>（1,500円 × {formData.players.length}名）を以下のPayPayID宛にご送金ください。
            </p>
            <div className="bg-white p-3 rounded border border-amber-300 font-mono text-xs space-y-1">
              <div>送金先PayPayID: <strong className="text-slate-900 select-all">hayapaaaay</strong></div>
              <div>メッセージ欄記入名: <strong className="text-slate-900">{formData.representativeName}</strong></div>
            </div>
            <p className="text-[11px] text-amber-800 leading-relaxed">
              ※ 送金時のメッセージ欄には必ず<strong>【代表者氏名: {formData.representativeName}】</strong>をご記入ください。送金確認をもって正式な受付完了となります。
            </p>
          </div>

          <Button
            type="button"
            onClick={() => router.push("/")}
            className="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs h-11"
          >
            大会ポータルトップへ戻る
          </Button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-100 p-4 md:p-8 flex flex-col items-center gap-6">
      <div className="w-full max-w-3xl bg-white border border-slate-200 rounded-lg shadow-sm p-6 md:p-8 space-y-6">
        
        <div className="flex items-center justify-between border-b border-slate-200 pb-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-bold bg-red-600 text-white px-2 py-0.5 rounded">
                参加申込
              </span>
              <span className="text-xs bg-slate-100 text-slate-700 font-semibold px-2 py-0.5 rounded">
                代表者まとめてエントリー
              </span>
            </div>
            <h1 className="text-xl font-black text-slate-900">
              第5回めんたいこ杯 参加エントリーフォーム
            </h1>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => router.push("/guidelines")}
            className="text-xs font-semibold"
          >
            <ArrowLeft className="w-3.5 h-3.5 mr-1" /> 要項へ戻る
          </Button>
        </div>

        <form onSubmit={handleSubmitEntry} className="space-y-8 text-xs">
          
          {/* 1. 代表者情報セクション */}
          <section className="space-y-4 p-5 bg-slate-50 border border-slate-200 rounded-lg">
            <div className="border-b border-slate-200 pb-2">
              <h2 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                <UserCheck className="w-4 h-4 text-slate-700" />
                参加申し込み代表者情報
              </h2>
              <p className="text-[11px] text-slate-500 mt-0.5">
                ご連絡先およびPayPay送金時の照合名義となります。
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  参加申し込み代表者 氏名 <span className="text-red-600">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="例: 早田 豊"
                  value={formData.representativeName}
                  onChange={(e) => handleRepresentativeChange("representativeName", e.target.value)}
                  className="w-full p-2.5 text-sm border border-slate-300 rounded-md bg-white focus:ring-2 focus:ring-slate-900 focus:outline-none font-bold text-slate-900"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  参加申し込み代表者 所属団体名 / 道場名
                </label>
                <input
                  type="text"
                  placeholder="例: 福岡弓道倶楽部（無所属の場合は空欄）"
                  value={formData.representativeOrganization}
                  onChange={(e) => handleRepresentativeChange("representativeOrganization", e.target.value)}
                  className="w-full p-2.5 text-sm border border-slate-300 rounded-md bg-white focus:ring-2 focus:ring-slate-900 focus:outline-none text-slate-900"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1 flex items-center gap-1">
                  <Mail className="w-3.5 h-3.5 text-slate-500" />
                  代表者メールアドレス <span className="text-red-600">*</span>
                </label>
                <input
                  type="email"
                  required
                  placeholder="example@domain.com"
                  value={formData.representativeEmail}
                  onChange={(e) => handleRepresentativeChange("representativeEmail", e.target.value)}
                  className="w-full p-2.5 text-sm border border-slate-300 rounded-md bg-white focus:ring-2 focus:ring-slate-900 focus:outline-none text-slate-900"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1 flex items-center gap-1">
                  <Phone className="w-3.5 h-3.5 text-slate-500" />
                  代表者携帯電話番号 <span className="text-red-600">*</span>
                </label>
                <input
                  type="tel"
                  required
                  placeholder="090-0000-0000"
                  value={formData.representativePhone}
                  onChange={(e) => handleRepresentativeChange("representativePhone", e.target.value)}
                  className="w-full p-2.5 text-sm border border-slate-300 rounded-md bg-white focus:ring-2 focus:ring-slate-900 focus:outline-none text-slate-900 font-mono"
                />
              </div>
            </div>

            <div className="p-3 bg-blue-50 border border-blue-200 rounded-md text-blue-900 text-[11px] leading-relaxed flex items-start gap-2">
              <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
              <span>
                <strong>【ご注意】</strong> 代表者様ご自身も選手として出場される場合は、下の【参加選手情報】欄にもお名前をご入力ください。
              </span>
            </div>
          </section>

          {/* 2. 参加選手情報セクション */}
          <section className="space-y-4">
            <div className="flex justify-between items-center border-b border-slate-200 pb-2">
              <div>
                <h2 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                  <Users className="w-4 h-4 text-slate-700" />
                  参加選手情報（{formData.players.length} 名）
                </h2>
                <p className="text-[11px] text-slate-500">
                  出場される選手を希望人数分ご登録ください。
                </p>
              </div>

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleAddPlayer}
                className="text-xs font-bold border-slate-300 bg-slate-50 hover:bg-slate-100 text-slate-900"
              >
                <UserPlus className="w-3.5 h-3.5 mr-1 text-slate-700" />
                選手を追加する
              </Button>
            </div>

            <div className="space-y-4">
              {formData.players.map((player, index) => (
                <div
                  key={index}
                  className="p-4 border border-slate-200 rounded-lg bg-white shadow-2xs space-y-4 relative"
                >
                  <div className="flex justify-between items-center border-b border-slate-100 pb-2">
                    <span className="text-xs font-black text-slate-900 bg-slate-100 px-2.5 py-1 rounded">
                      選手 {index + 1}
                    </span>

                    {formData.players.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemovePlayer(index)}
                        className="text-xs text-red-600 hover:text-red-700 hover:bg-red-50 h-7 px-2"
                      >
                        <Trash2 className="w-3.5 h-3.5 mr-1" />
                        この選手を削除
                      </Button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">
                        参加選手名 <span className="text-red-600">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        placeholder="例: 佐藤 健一"
                        value={player.name}
                        onChange={(e) => handlePlayerChange(index, "name", e.target.value)}
                        className="w-full p-2.5 text-sm border border-slate-300 rounded-md focus:ring-2 focus:ring-slate-900 focus:outline-none font-bold text-slate-900"
                      />
                    </div>

                    <div>
                      <label className="block font-bold text-slate-700 mb-1">
                        ふりがな <span className="text-red-600">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        placeholder="例: さとう けんいち"
                        value={player.nameKana}
                        onChange={(e) => handlePlayerChange(index, "nameKana", e.target.value)}
                        className="w-full p-2.5 text-sm border border-slate-300 rounded-md focus:ring-2 focus:ring-slate-900 focus:outline-none text-slate-900"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* 所作選択 */}
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">
                        所作の選択 <span className="text-red-600">*</span>
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        {(["肌脱ぎ", "襷掛け"] as ShosaType[]).map((shosaOption) => (
                          <div
                            key={shosaOption}
                            onClick={() => handlePlayerChange(index, "shosa", shosaOption)}
                            className={`p-2 border rounded-md text-center cursor-pointer font-bold transition-all text-xs ${
                              player.shosa === shosaOption
                                ? "border-slate-900 bg-slate-900 text-white shadow-xs"
                                : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100"
                            }`}
                          >
                            {shosaOption}
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* 称号・段位選択 */}
                    <div>
                      <label className="block font-bold text-slate-700 mb-1 flex items-center gap-1">
                        <Award className="w-3.5 h-3.5 text-amber-600" />
                        称号・段位 <span className="text-red-600">*</span>
                      </label>
                      <select
                        value={player.rankTitle}
                        onChange={(e) => handlePlayerChange(index, "rankTitle", sanitizeRankTitle(e.target.value))}
                        className="w-full p-2.5 text-xs border border-slate-300 rounded-md bg-white font-bold text-slate-900 focus:ring-2 focus:ring-slate-900"
                      >
                        <option value="段位は三段以下">段位は三段以下</option>
                        <option value="段位は四段以上">段位は四段以上</option>
                        <option value="称号を取得している">称号を取得している</option>
                      </select>
                    </div>
                  </div>

                  {/* チェックボックス群 */}
                  <div className="space-y-2 pt-1">
                    <label className="flex items-start gap-2.5 p-2.5 bg-slate-50 border border-slate-200 rounded-md cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={player.needsSupport}
                        onChange={(e) => handlePlayerChange(index, "needsSupport", e.target.checked)}
                        className="mt-0.5 rounded text-slate-900 focus:ring-slate-900"
                      />
                      <span className="text-slate-700 leading-relaxed text-[11px]">
                        本座での肌脱ぎ・襷掛けが不慣れなため、サポートの必要性がある（配慮を希望）
                      </span>
                    </label>

                    <label className="flex items-start gap-2.5 p-2.5 bg-amber-50/60 border border-amber-200 rounded-md cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={player.isStaffVolunteer}
                        onChange={(e) => handlePlayerChange(index, "isStaffVolunteer", e.target.checked)}
                        className="mt-0.5 rounded text-slate-900 focus:ring-slate-900"
                      />
                      <div>
                        <span className="font-bold text-amber-950 text-xs">
                          大会役員（半日スタッフ）の協力が可能
                        </span>
                        <p className="text-[11px] text-amber-800 mt-0.5">
                          この選手の大会役員協力希望を有りとして登録します。
                        </p>
                      </div>
                    </label>
                  </div>
                </div>
              ))}
            </div>

            <Button
              type="button"
              variant="outline"
              onClick={handleAddPlayer}
              className="w-full text-xs font-bold border-dashed border-2 border-slate-300 py-3 text-slate-700 hover:bg-slate-50"
            >
              <UserPlus className="w-4 h-4 mr-1.5" />
              さらに別の参加選手を追加する
            </Button>
          </section>

          {/* 3. 役員案内 */}
          <section className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-2 text-slate-700">
            <h3 className="font-bold text-slate-900 text-xs flex items-center gap-1.5">
              <HelpCircle className="w-4 h-4 text-slate-600" />
              大会役員協力に関するご案内
            </h3>
            <ul className="list-disc list-inside space-y-1 text-[11px] text-slate-600 leading-relaxed bg-white p-3 rounded border border-slate-200">
              <li>役員担当時間は<strong>終日ではなく「半日」</strong>となります。</li>
              <li>ご協力いただいた方には<strong>薄礼（報酬）</strong>をご用意しております。</li>
              <li>担当役割（進行、的前、招集、記録、カメラマン等）は<strong>大会運営側にて設定・割り当て</strong>を行います。</li>
              <li>当日の立順や射場配置の都合上、<strong>他チーム・他道場の方と組み合わせ</strong>になる場合がございます。</li>
            </ul>
          </section>

          {/* 4. 備考欄 */}
          <section className="space-y-1.5">
            <label className="block font-bold text-slate-700 text-xs">
              運営に伝えたいこと（備考欄）
            </label>
            <textarea
              rows={3}
              placeholder="質問、連絡事項、配慮事項等があればご自由にご記入ください。"
              value={formData.notes}
              onChange={(e) => handleRepresentativeChange("notes", e.target.value)}
              className="w-full p-3 text-sm border border-slate-300 rounded-md focus:ring-2 focus:ring-slate-900 focus:outline-none text-slate-900"
            />
          </section>

          {/* 5. 合計参加費 */}
          <section className="p-4 bg-slate-900 text-white rounded-lg space-y-3">
            <div className="flex justify-between items-center border-b border-slate-700 pb-2">
              <span className="text-xs text-slate-300">
                参加選手合計: <strong>{formData.players.length}</strong> 名 × 1,500円
              </span>
              <span className="text-xs font-bold text-amber-400">
                お支払い合計: <strong className="text-lg text-white font-black">{totalFee.toLocaleString()}</strong> 円
              </span>
            </div>
            <p className="text-[11px] text-slate-300 leading-relaxed">
              ※ 送信完了後、代表者様のお名前（{formData.representativeName || "代表者名"}）をメッセージ欄に記載の上、PayPay送金先（ID: <strong className="text-white">hayapaaaay</strong>）へご送金ください。
            </p>
          </section>

          {errorMessage && (
            <div className="p-3 bg-red-50 border border-red-200 rounded text-xs text-red-600 font-bold flex items-center gap-1.5">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {errorMessage}
            </div>
          )}

          <Button
            type="submit"
            disabled={isSubmitting}
            className="w-full h-14 bg-red-600 hover:bg-red-700 text-white font-black text-base shadow-md disabled:opacity-40 active:scale-98 transition-transform"
          >
            {isSubmitting
              ? "エントリー登録処理中..."
              : `全 ${formData.players.length} 名の参加を申し込む（合計 ${totalFee.toLocaleString()} 円）`}
          </Button>
        </form>
      </div>
    </main>
  );
}