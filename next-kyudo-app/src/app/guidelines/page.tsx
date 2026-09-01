"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { doc, onSnapshot } from "firebase/firestore";
import { db, isFirebaseConfigured, isFirestoreAvailable } from "@/lib/firebase";
import { TournamentConfig } from "@/types";
import { Button } from "@/components/ui/button";
import {
  Calendar,
  MapPin,
  Award,
  CheckSquare,
  Square,
  ArrowRight,
  ShieldCheck,
  CreditCard,
  Shirt,
  Smartphone,
  ExternalLink,
  Users,
  AlertTriangle,
  Clock
} from "lucide-react";

// フェイルセーフ: Firestore未接続またはドキュメント不在時の安全側初期データ
const DEFAULT_CONFIG: TournamentConfig = {
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

export default function GuidelinesPage() {
  const router = useRouter();
  const [config, setConfig] = useState<TournamentConfig>(DEFAULT_CONFIG);
  const [hasAgreed, setHasAgreed] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<Date>(new Date());

  // 現在時刻の定期更新（受付期間内外の判定用）
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Firestoreからエントリー期間設定をリアルタイム購読
  useEffect(() => {
    if (!isFirebaseConfigured || !isFirestoreAvailable(db)) return;

    const docRef = doc(db, "matches", config.matchId);
    const unsubscribe = onSnapshot(
      docRef,
      (snap) => {
        if (snap.exists()) {
          const data = snap.data() as Partial<TournamentConfig>;
          setConfig((prev: TournamentConfig) => ({
            ...prev,
            ...data,
            entryStartDate: typeof data.entryStartDate === "string" ? data.entryStartDate : prev.entryStartDate,
            entryEndDate: typeof data.entryEndDate === "string" ? data.entryEndDate : prev.entryEndDate,
            isEntryEnabled: typeof data.isEntryEnabled === "boolean" ? data.isEntryEnabled : prev.isEntryEnabled,
          }));
        }
      },
      (error) => {
        console.error("【エラーログ】エントリー期間設定の購読失敗:", error);
      }
    );

    return () => unsubscribe();
  }, [config.matchId]);

  // フールプルーフ: 受付期間の動的判定
  const startDate = new Date(config.entryStartDate);
  const endDate = new Date(config.entryEndDate);
  const isBeforePeriod = currentTime < startDate;
  const isAfterPeriod = currentTime > endDate;
  const isWithinPeriod = !isBeforePeriod && !isAfterPeriod && config.isEntryEnabled;

  // エントリー入力ページへの遷移ハンドラ（フールプルーフ: 期間外または未同意をブロック）
  const handleProceedToEntry = () => {
    if (!hasAgreed || !isWithinPeriod) return;

    try {
      sessionStorage.setItem("mentaiko_terms_agreed", "true");
      sessionStorage.setItem("mentaiko_terms_agreed_time", Date.now().toString());
    } catch (e) {
      console.warn("【警告】sessionStorage保存失敗:", e);
    }

    router.push("/entry");
  };

  return (
    <main className="min-h-screen bg-slate-100 p-4 md:p-8 flex flex-col items-center gap-6">
      <div className="w-full max-w-4xl bg-white border border-slate-200 rounded-lg shadow-sm p-6 md:p-8 space-y-8">
        
        {/* ヘッダー・大会名 */}
        <div className="border-b border-slate-200 pb-4">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-xs font-bold bg-red-600 text-white px-2.5 py-0.5 rounded">
              大会要項・参加同意事項
            </span>
            <span className="text-xs bg-slate-100 text-slate-700 font-semibold px-2 py-0.5 rounded">
              着物着用・ペーパーレス運営
            </span>
          </div>
          <h1 className="text-2xl md:text-3xl font-black text-slate-900">
            第5回めんたいこ杯争奪弓道大会
          </h1>
          <p className="text-xs text-slate-500 mt-1">主催: めんたいこ杯争奪弓道大会実行委員会</p>
        </div>

        {/* 期間ステータスバナー（フールプルーフ表示） */}
        <div className={`p-4 rounded-lg border flex items-center justify-between flex-wrap gap-3 ${
          isWithinPeriod
            ? "bg-emerald-50 border-emerald-300 text-emerald-950"
            : isBeforePeriod
            ? "bg-amber-50 border-amber-300 text-amber-950"
            : "bg-red-50 border-red-300 text-red-950"
        }`}>
          <div className="flex items-center gap-2.5">
            <Clock className={`w-5 h-5 shrink-0 ${
              isWithinPeriod ? "text-emerald-700" : isBeforePeriod ? "text-amber-700" : "text-red-700"
            }`} />
            <div>
              <p className="text-xs font-bold">
                {isWithinPeriod
                  ? "【エントリー受付中】"
                  : isBeforePeriod
                  ? "【エントリー受付開始前】"
                  : "【エントリー受付終了】"}
              </p>
              <p className="text-[11px] opacity-90 mt-0.5">
                受付期間: {config.entryStartDate.replace("T", " ")} 〜 {config.entryEndDate.replace("T", " ")}
              </p>
            </div>
          </div>
          <span className={`text-xs font-bold px-3 py-1 rounded-full ${
            isWithinPeriod ? "bg-emerald-600 text-white" : "bg-slate-300 text-slate-700"
          }`}>
            {isWithinPeriod ? "申込可能" : "申込不可"}
          </span>
        </div>

        {/* 基本要項グリッド */}
        <section className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <div className="p-4 bg-slate-50 rounded-lg border border-slate-200 space-y-1">
            <span className="font-bold text-slate-500 flex items-center gap-1.5">
              <Calendar className="w-4 h-4 text-slate-700" /> 日時
            </span>
            <p className="font-bold text-sm text-slate-900">2027年3月29日(日) 10:00（受付 9:30）</p>
            <p className="text-[11px] text-slate-500">
              申込期間: {config.entryStartDate.split("T")[0]} 〜（先着100名程度）
            </p>
          </div>

          <div className="p-4 bg-slate-50 rounded-lg border border-slate-200 space-y-1">
            <span className="font-bold text-slate-500 flex items-center gap-1.5">
              <MapPin className="w-4 h-4 text-slate-700" /> 会場
            </span>
            <p className="font-bold text-sm text-slate-900">福岡市総合体育館内 弓道場</p>
            <p className="text-[11px] text-slate-500">福岡県福岡市東区香椎照葉６丁目１−１</p>
            <a
              href="https://www.fukuoka-city-arena.jp"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] text-blue-600 hover:underline flex items-center gap-1 mt-0.5"
            >
              会場Webサイト <ExternalLink className="w-3 h-3" />
            </a>
          </div>

          <div className="p-4 bg-slate-50 rounded-lg border border-slate-200 space-y-1">
            <span className="font-bold text-slate-500 flex items-center gap-1.5">
              <Users className="w-4 h-4 text-slate-700" /> 対象・種別
            </span>
            <p className="font-bold text-sm text-slate-900">一般弓道愛好家（大学生含む）着物着用</p>
            <p className="text-[11px] text-slate-500">男女混合による個人競技（的中制）</p>
          </div>

          <div className="p-4 bg-slate-50 rounded-lg border border-slate-200 space-y-1">
            <span className="font-bold text-slate-500 flex items-center gap-1.5">
              <CreditCard className="w-4 h-4 text-slate-700" /> 参加費・支払方法
            </span>
            <p className="font-bold text-sm text-slate-900">1,500円（PayPay事前決済のみ）</p>
            <p className="text-[11px] text-slate-600 font-mono">送金先PayPayID: <strong className="text-slate-900">hayapaaaay</strong></p>
          </div>
        </section>

        {/* 大会の趣旨 */}
        <section className="p-4 bg-amber-50/50 rounded-lg border border-amber-200 text-slate-800 text-xs leading-relaxed space-y-2">
          <h2 className="text-sm font-bold text-amber-900 flex items-center gap-1.5">
            <Award className="w-4 h-4 text-amber-700" /> 大会の趣旨
          </h2>
          <p>
            「第5回めんたいこ杯争奪弓道大会」では、過去の大会と同様に着物着用、ならびに一次審査の要領による行射を本大会独自の趣旨として掲げております。
          </p>
          <p>
            着物着用の競技会は数少なく、貴重な機会となります。入場から本座、射位に至る中で、肌脱ぎ・襷掛けを含んだ体さばきの一連の所作と、射の協働を深く実感していただく競技会を目指しております。
          </p>
          <p>
            本大会を通してお互いの技術と品格の向上を図り、審査や公式競技会で日頃の修練の成果を遺憾なく発揮できるような経験と交流の場になれば幸いに存じます。
          </p>
        </section>

        {/* 競技の進め方・ルール */}
        <section className="space-y-3 text-xs text-slate-800">
          <h2 className="text-sm font-bold text-slate-900 border-b border-slate-200 pb-1">
            競技方法および進行形式
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-md space-y-1">
              <p className="font-bold text-slate-900">【午前の部】一次審査の要領にて二立（一手2射 × 2立 = 4射）</p>
              <p className="text-slate-600">坐射の方は本座にて肌脱ぎ・襷掛けを行います。</p>
            </div>
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-md space-y-1">
              <p className="font-bold text-slate-900">【午後の部】立射にて四矢一立（4射 × 1立 = 4射）</p>
              <p className="text-slate-600">肌脱ぎ・襷掛けを済ませた状態から入場します。</p>
            </div>
          </div>
          <ul className="list-disc list-inside space-y-1 text-slate-600 bg-slate-50 p-3 rounded-md border border-slate-200">
            <li>全日本弓道連盟競技規則及び本大会申し合わせ事項により執り行います。</li>
            <li>順位決定: <strong>優勝決定のみ射詰め、その他（2位〜10位）は遠近法</strong>により決定します。</li>
            <li>各立順は、他地区・他道場の方と組めるよう運営委員会にて設定します。</li>
          </ul>
        </section>

        {/* 表彰規定 */}
        <section className="space-y-2 text-xs text-slate-800">
          <h2 className="text-sm font-bold text-slate-900 border-b border-slate-200 pb-1">
            表彰・賞
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="p-2.5 bg-slate-50 border border-slate-200 rounded text-center font-bold">一手束中賞</div>
            <div className="p-2.5 bg-slate-50 border border-slate-200 rounded text-center font-bold">四矢皆中賞</div>
            <div className="p-2.5 bg-slate-50 border border-slate-200 rounded text-center font-bold">個人表彰（上位10名）</div>
            <div className="p-2.5 bg-slate-50 border border-slate-200 rounded text-center font-bold">余興賞</div>
          </div>
          <p className="text-[11px] text-slate-500">※ 的中数上位者には納射をお願いいたします。</p>
        </section>

        {/* 参加にあたっての注意事項 */}
        <section className="space-y-3 text-xs text-slate-800">
          <h2 className="text-sm font-bold text-slate-900 border-b border-slate-200 pb-1">
            参加にあたっての注意事項
          </h2>
          <div className="space-y-3">
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-md space-y-1">
              <span className="font-bold text-slate-900 flex items-center gap-1">
                <Shirt className="w-3.5 h-3.5 text-slate-700" /> 服装について
              </span>
              <p className="text-slate-600 leading-relaxed">
                縞袴や色袴、黒紋付、訪問着などでのご参加を歓迎いたします。坐射の方は本座で肌脱ぎ・襷掛けができる着物でご参加ください。不慣れな方はエントリー時にお知らせください。
              </p>
            </div>

            <div className="p-3 bg-slate-50 border border-slate-200 rounded-md space-y-1">
              <span className="font-bold text-slate-900 flex items-center gap-1">
                <Smartphone className="w-3.5 h-3.5 text-slate-700" /> ペーパーレス運営・大会役員募集
              </span>
              <p className="text-slate-600 leading-relaxed">
                進行や成績発表はWEB上で行いますので、インターネット接続可能なスマートフォン等を必ずご準備ください。
                また、半日単位でご協力いただける大会役員（進行、的前、招集、記録、カメラマン、運営）を募集しております。
              </p>
            </div>

            <div className="p-3 bg-slate-50 border border-slate-200 rounded-md space-y-1">
              <span className="font-bold text-slate-900 flex items-center gap-1">
                <CreditCard className="w-3.5 h-3.5 text-slate-700" /> 参加費のお支払い手順
              </span>
              <p className="text-slate-600 leading-relaxed">
                参加費1,500円はPayPay事前決済のみとなります。送金先ID <strong>hayapaaaay</strong> 宛に、メッセージ欄へ<strong>【参加申込代表者のお名前】</strong>を必ずご記載の上ご送金ください。支払い完了をもって受付完了となります。
              </p>
            </div>

            <div className="p-3 bg-slate-50 border border-slate-200 rounded-md space-y-1">
              <span className="font-bold text-slate-900 flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5 text-slate-700" /> 昼食・安全管理・保険
              </span>
              <p className="text-slate-600 leading-relaxed">
                昼食の提供はございません（会場内飲食可能）。スポーツ安全保険等への各自加入をお願いいたします。応急処置は行いますが以降の責任は負いかねます。
              </p>
            </div>
          </div>
        </section>

        {/* 付帯規程・免責事項・個人情報取扱 */}
        <section className="space-y-4 text-xs text-slate-700">
          <h2 className="text-sm font-bold text-slate-900 border-b border-slate-200 pb-1.5">
            付帯規程・免責事項および個人情報取扱
          </h2>

          {/* 1. 参加費使途・景品表示法 */}
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
            <h3 className="font-bold text-slate-900 text-xs flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-slate-600"></span>
              参加費の使途および表彰・景品提供に関する規程（景品表示法の遵守）
            </h3>
            <p className="leading-relaxed">
              <strong>【参加費の使途】</strong> 参加費は、大会運営にかかる実費（会場使用料、設営費、運営スタッフ人件費、消耗品費など）に充当いたします。本大会の参加費は、成績に応じた賞品（景品類）の提供を受けるための対価ではありません。
            </p>
            <p className="leading-relaxed">
              <strong>【表彰】</strong> 本大会は参加者の競技力向上及び親睦を目的としており、成績優秀者には功績を称え表彰を行います。成績優秀者への表彰品は、金銭的価値のない記念品のみといたします。
            </p>
            <div className="bg-white p-3 rounded border border-slate-200 space-y-1.5 mt-2">
              <p className="font-semibold text-slate-800">【景品提供の2つの適用基準（一般懸賞規制の遵守）】</p>
              <p className="text-[11px] text-slate-600">
                参加費を原資として提供される景品類は、成績の優劣にかかわらず主に参加賞や抽選等として提供し、以下の2つの基準を同時に満たす範囲内で運用いたします。
              </p>
              <ul className="list-disc list-inside text-[11px] text-slate-600 space-y-0.5 ml-1">
                <li><strong>基準1（最高額）:</strong> 1つの賞品につき上限 30,000円（参加費1,500円×20倍）以内</li>
                <li><strong>基準2（総 額）:</strong> 提供するすべての賞品の合計額が売上予定総額（参加費×参加人数）の 2% 以内</li>
              </ul>
            </div>
          </div>

          {/* 2. 免責事項・未成年同意・安全管理 */}
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
            <h3 className="font-bold text-slate-900 text-xs flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-slate-600"></span>
              免責事項・安全管理および未成年者の参加同意
            </h3>
            <p className="leading-relaxed">
              <strong>【自己責任の原則と事故対応】</strong> 競技中および会場内（移動中を含む）で発生した負傷、病気、盗難、その他の事故について、大会運営本部は一切の責任を負いません。不慮の事故発生時は応急処置のみを行いますが、その後の治療費、補償、賠償責任等は負いかねます。各自でスポーツ安全保険等への加入を強く推奨いたします。
            </p>
            <p className="leading-relaxed">
              <strong>【安全管理の遵守】</strong> 行射中の安全確保および弓具の点検・管理は各自の責任において行ってください。運営側が危険と判断した場合は、競技を中断または失格とすることがあります。
            </p>
            <p className="leading-relaxed bg-amber-50/70 p-2.5 rounded border border-amber-200 text-amber-950">
              <strong>【未成年者の参加および保護者の同意】</strong> 18歳未満の方および高校生が参加する場合、保護者（または引率責任者）の明確な同意を必須条件とします。申込完了時点で保護者の完全な同意が得られているものとみなします。同意のない事実や虚偽申告が判明した際は即刻失格・退場処分（返金不可）とし、トラブル等について運営本部は一切の責任を負いません。
            </p>
          </div>

          {/* 3. 個人情報および写真・映像取扱 */}
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
            <h3 className="font-bold text-slate-900 text-xs flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-slate-600"></span>
              個人情報および写真・映像（肖像権）の取り扱い
            </h3>
            <p className="leading-relaxed">
              <strong>【利用目的・第三者提供】</strong> 取得した個人情報（氏名・段位・連絡先等）は、大会運営、結果公表、事前連絡にのみ利用します。法令に基づく場合を除き、本人の同意なく第三者へ提供いたしません。
            </p>
            <p className="leading-relaxed">
              <strong>【写真・映像の共有とSNS利用】</strong> 主催者が撮影した記録は後日参加者限定で共有いたします。共有画像をSNS等へ掲載する場合は被写体の承諾を得るなど権利侵害にご配慮ください（無断転載等のトラブルについて運営本部は責任を負いかねます）。
            </p>
            <p className="text-[11px] text-slate-500">※ これらの情報の保有期間は、大会開催日より最大1年間といたします。</p>
          </div>
        </section>

        {/* 誓約事項 ＆ 同意チェック・エントリー遷移 */}
        <section className="pt-4 border-t border-slate-200 space-y-4">
          <div className="p-4 bg-slate-900 text-white rounded-lg space-y-1.5 text-xs">
            <p className="font-bold flex items-center gap-1.5 text-amber-400">
              <AlertTriangle className="w-4 h-4 text-amber-400" />
              【重要】大会参加への誓約・同意事項
            </p>
            <p className="text-slate-300 leading-relaxed">
              大会要項および付帯事項（景品表示法の遵守、免責事項、未成年者の保護者同意、個人情報・肖像権の取り扱いを含むすべての項目）を熟読・理解した上で、すべての内容に同意および遵守することを誓約します。
            </p>
          </div>

          {/* 同意確認チェックボックス（フールプルーフ: 期間外はクリック不可） */}
          <div
            onClick={() => isWithinPeriod && setHasAgreed(!hasAgreed)}
            className={`p-4 rounded-lg border flex items-center gap-3 select-none transition-colors ${
              !isWithinPeriod
                ? "bg-slate-100 border-slate-200 opacity-60 cursor-not-allowed"
                : hasAgreed
                ? "bg-slate-900 border-slate-900 text-white cursor-pointer"
                : "bg-slate-50 border-slate-300 hover:bg-slate-100 text-slate-800 cursor-pointer"
            }`}
          >
            {hasAgreed ? (
              <CheckSquare className="w-5 h-5 text-white shrink-0" />
            ) : (
              <Square className="w-5 h-5 text-slate-400 shrink-0" />
            )}
            <span className="text-xs font-bold leading-relaxed">
              上記「第5回めんたいこ杯争奪弓道大会」の要項、趣旨、競技方法、注意事項、付帯規程および参加同意事項の全内容を理解し、同意します。
            </span>
          </div>

          {/* エントリー画面遷移ボタン（フールプルーフ: 期間外・未同意時は遮断） */}
          <Button
            type="button"
            onClick={handleProceedToEntry}
            disabled={!hasAgreed || !isWithinPeriod}
            className="w-full h-14 bg-red-600 hover:bg-red-700 text-white font-black text-base shadow-md disabled:opacity-40 active:scale-98 transition-transform"
          >
            {isBeforePeriod
              ? "エントリー受付開始前です"
              : isAfterPeriod
              ? "エントリー受付は終了いたしました"
              : !config.isEntryEnabled
              ? "現在エントリー受付を停止しております"
              : !hasAgreed
              ? "要項に同意するとエントリーへ進めます"
              : "同意してエントリー入力フォームへ進む"}
            <ArrowRight className="w-5 h-5 ml-2" />
          </Button>
        </section>

      </div>
    </main>
  );
}