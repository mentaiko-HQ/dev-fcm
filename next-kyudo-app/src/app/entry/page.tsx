/**
 * 【参加者エントリーページ】
 * /entry パスに対応するページコンポーネント。
 * エントリー時点では組番号・立順（射位）を未設定（null）として保存し、
 * 大会運営本部（/admin/check）にて後から手動で立ち割り当てる運用フローに対応。
 * Firestoreへの一括バッチ登録後、FastAPIバックエンド経由で確認メールを送信する。
 *
 * レイアウト構成:
 * 1. 参加申し込み代表者情報
 * 2. 運営に伝えたいこと（備考欄）
 * 3. 参加選手情報（動的追加・削除・個別配慮事項）
 * 4. 参加費合計および送金手順案内
 *
 * フールプルーフ設計:
 * - 必須項目（代表者氏名、メールアドレス、電話番号、選手氏名、ふりがな）の事前バリデーション。
 * - エントリー時点の組番号・立順（standAssignments）はすべて明示的に null で初期化し、
 *   仮計算による誤った立順の確定を防止。
 * - 新規選手登録時に isHayaHit: false を初期値として設定し、Participant 型の整合性を保証。
 * - 多重クリックによる二重登録防止（isSubmittingによるボタン非活性化）。
 *
 * フェイルセーフ設計:
 * - AbortController を用いた5秒タイムアウト制御。FastAPIサーバーが停止・応答不能でもブラウザがフリーズしない。
 * - メール送信に失敗した場合でも、Firestoreへのエントリー保存は確定させ、
 *   画面上でPayPay送金案内を表示してフローを継続。
 */

'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { collection, doc, writeBatch, getDocs } from 'firebase/firestore';
import { db, isFirebaseConfigured, isFirestoreAvailable } from '@/lib/firebase';
import {
  RepresentativeEntryFormData,
  EntryPlayerItem,
  ShosaType,
  RankTitleType,
  StandRoundIndex,
  Participant,
  StandAssignment,
} from '@/types';
import { Button } from '@/components/ui/button';
import {
  ArrowLeft,
  CheckCircle2,
  AlertCircle,
  CreditCard,
  UserPlus,
  Trash2,
  Users,
  UserCheck,
  Mail,
  Phone,
  Award,
} from 'lucide-react';

const ENTRY_FEE_PER_PERSON = 1500;
const API_TIMEOUT_MS = 5000;

function sanitizeRankTitle(val: unknown): RankTitleType {
  if (
    val === '称号を取得している' ||
    val === '段位は四段以上' ||
    val === '段位は三段以下'
  ) {
    return val;
  }
  return '段位は三段以下';
}

export default function EntryFormPage() {
  const router = useRouter();

  // 【フールプルーフ】要項同意セッションがない場合は強制的に要項ページへリダイレクト
  useEffect(() => {
    try {
      const agreed = sessionStorage.getItem('mentaiko_terms_agreed');
      if (agreed !== 'true') {
        router.replace('/guidelines');
      }
    } catch {
      router.replace('/guidelines');
    }
  }, [router]);

  const [formData, setFormData] = useState<RepresentativeEntryFormData>({
    representativeName: '',
    representativeEmail: '',
    representativePhone: '',
    representativeOrganization: '',
    players: [
      {
        name: '',
        nameKana: '',
        shosa: '肌脱ぎ',
        rankTitle: '段位は三段以下',
        needsSupport: false,
        isStaffVolunteer: false,
      },
    ],
    notes: '',
  });

  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isSuccess, setIsSuccess] = useState<boolean>(false);
  const [registeredPlayers, setRegisteredPlayers] = useState<
    Array<{ name: string; bibNumber: number }>
  >([]);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [emailStatusMessage, setEmailStatusMessage] = useState<string>('');

  const handleRepresentativeChange = (
    field: keyof Omit<RepresentativeEntryFormData, 'players'>,
    value: string,
  ) => {
    setFormData((prev: RepresentativeEntryFormData) => ({
      ...prev,
      [field]: value,
    }));
    setErrorMessage('');
  };

  const handleAddPlayer = () => {
    setFormData((prev: RepresentativeEntryFormData) => ({
      ...prev,
      players: [
        ...prev.players,
        {
          name: '',
          nameKana: '',
          shosa: '肌脱ぎ',
          rankTitle: '段位は三段以下',
          needsSupport: false,
          isStaffVolunteer: false,
        },
      ],
    }));
  };

  const handleRemovePlayer = (index: number) => {
    if (formData.players.length <= 1) return;
    setFormData((prev: RepresentativeEntryFormData) => ({
      ...prev,
      players: prev.players.filter(
        (_: EntryPlayerItem, i: number) => i !== index,
      ),
    }));
  };

  const handlePlayerChange = (
    index: number,
    field: keyof EntryPlayerItem,
    value: unknown,
  ) => {
    setFormData((prev: RepresentativeEntryFormData) => {
      const updatedPlayers = [...prev.players];
      updatedPlayers[index] = {
        ...updatedPlayers[index],
        [field]: value,
      };
      return { ...prev, players: updatedPlayers };
    });
    setErrorMessage('');
  };

  /**
   * 【データ登録・メール送信処理】
   * 1. 入力内容のバリデーション
   * 2. Firestore への一括バッチ保存（立ち順・組番号は未設定 null として登録）
   * 3. FastAPI への非同期メール送信リクエスト（タイムアウト＆例外安全）
   */
  const handleSubmitEntry = async (e: React.FormEvent) => {
    e.preventDefault();

    // 【フールプルーフ】代表者情報の必須検証
    if (!formData.representativeName.trim()) {
      setErrorMessage('参加申し込み代表者のお名前を入力してください。');
      return;
    }
    if (!formData.representativeEmail.trim()) {
      setErrorMessage('代表者メールアドレスを入力してください。');
      return;
    }
    if (!formData.representativePhone.trim()) {
      setErrorMessage('代表者携帯電話番号を入力してください。');
      return;
    }

    // 【フールプルーフ】全登録選手の必須検証
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
    setErrorMessage('');
    setEmailStatusMessage('');

    try {
      const assignedList: Array<{ name: string; bibNumber: number }> = [];

      // 1. Firestore へのデータ書き込み
      if (isFirebaseConfigured && isFirestoreAvailable(db)) {
        const firestoreInstance = db;
        const entriesSnap = await getDocs(
          collection(firestoreInstance, 'entries'),
        );
        let currentCount = entriesSnap.size;

        const batch = writeBatch(firestoreInstance);
        const now = Date.now();

        formData.players.forEach((player: EntryPlayerItem) => {
          currentCount += 1;
          const bibNumber = currentCount;

          const newEntryId = `player_${bibNumber}`;
          const entryDocRef = doc(firestoreInstance, 'entries', newEntryId);

          // 【新運用仕様】エントリー時点では第1立・第2立・第3立すべて未割当（null）として登録
          const unassignedSlot: StandAssignment = {
            standGroup: null,
            standOrder: null,
          };

          const safeAssignments: Record<StandRoundIndex, StandAssignment> = {
            1: unassignedSlot,
            2: unassignedSlot,
            3: unassignedSlot,
          };

          const newParticipant: Participant = {
            id: newEntryId,
            bibNumber,
            name: player.name.trim(),
            nameKana: player.nameKana.trim(),
            organization:
              formData.representativeOrganization.trim() || '無所属',
            shosa: player.shosa,
            rankTitle: sanitizeRankTitle(player.rankTitle),
            staffRole: player.isStaffVolunteer ? '運営' : '無し',
            staffDutyShift: player.isStaffVolunteer ? 'AM' : '無し',
            checkInStatus: 'UNCHECKED',
            checkInAt: null,
            isStaffVolunteer: player.isStaffVolunteer,
            needsSupport: player.needsSupport,
            standAssignments: safeAssignments,
            progressStatus: 'WAITING',
            qualificationStatus: 'ACTIVE',
            stand1_arrows: [],
            stand2_arrows: [],
            stand3_arrows: [],
            isHayaHit: false,
            totalHits: 0,
            totalShots: 8,
            isPerfect: false,
            enkinRank: null,
            finalRank: null,
            representativeName: formData.representativeName.trim(),
            representativeEmail: formData.representativeEmail.trim(),
            representativePhone: formData.representativePhone.trim(),
            representativeOrganization:
              formData.representativeOrganization.trim(),
            isPaid: false,
            paidAt: null,
            notes: formData.notes.trim(),
            agreedAt: now,
            updatedAt: now,
          };

          batch.set(entryDocRef, newParticipant);
          assignedList.push({ name: player.name.trim(), bibNumber });
        });

        await batch.commit();
      } else {
        formData.players.forEach((player: EntryPlayerItem, idx: number) => {
          assignedList.push({ name: player.name.trim(), bibNumber: 100 + idx });
        });
      }

      // 2. FastAPIバックエンド経由でResendメール送信呼び出し
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

      try {
        const response = await fetch(
          'http://127.0.0.1:8000/api/v1/email/send-confirmation',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
              to_email: formData.representativeEmail.trim(),
              representative_name: formData.representativeName.trim(),
              player_names: formData.players.map((p: EntryPlayerItem) =>
                p.name.trim(),
              ),
              total_fee: formData.players.length * ENTRY_FEE_PER_PERSON,
            }),
          },
        );

        clearTimeout(timeoutId);

        if (!response.ok) {
          setEmailStatusMessage(
            `メール配信サーバー警告（HTTP ${response.status}）: メールの送信が行えませんでした。`,
          );
        } else {
          const result = await response.json();
          if (!result.success) {
            setEmailStatusMessage(`メール送信案内: ${result.message}`);
          } else {
            setEmailStatusMessage('確認メールを正常に送信しました。');
          }
        }
      } catch (mailErr: unknown) {
        clearTimeout(timeoutId);
        console.error('【メール送信API通信例外】詳細ログ:', mailErr);
        setEmailStatusMessage(
          '確認メール送信APIへの接続に失敗しました（エントリー登録は正常に完了しています）。',
        );
      }

      setRegisteredPlayers(assignedList);
      setIsSuccess(true);
    } catch (err: unknown) {
      console.error('【一括エントリー送信失敗】詳細ログ:', err);
      setErrorMessage(
        'エントリー登録に失敗しました。通信環境をご確認の上、再度お試しください。',
      );
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
            <h2 className="text-xl font-black text-slate-900">
              エントリーを受け付けました
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              第5回めんたいこ杯争奪弓道大会（代表者:{' '}
              {formData.representativeName} 様）
            </p>
          </div>

          {/* メール送信結果通知 */}
          <div
            className={`p-4 rounded-lg text-xs space-y-1.5 leading-relaxed border ${
              emailStatusMessage.includes('警告') ||
              emailStatusMessage.includes('失敗')
                ? 'bg-amber-50 border-amber-200 text-amber-950'
                : 'bg-blue-50 border-blue-200 text-blue-950'
            }`}
          >
            <p className="font-bold flex items-center gap-1.5">
              <Mail className="w-4 h-4 text-blue-600" />{' '}
              仮エントリー受付メールの送信結果
            </p>
            <p>
              入力されたメールアドレス（
              <strong className="text-slate-900 font-mono">
                {formData.representativeEmail}
              </strong>
              ）宛への送信状態:
            </p>
            <p className="font-semibold text-xs mt-1">{emailStatusMessage}</p>
            <p className="text-[11px] text-slate-600 pt-1 border-t border-slate-200/60">
              ※万が一メールが未達の場合はメールアドレスの間違いの可能性があります。その場合は、mentaiko.trophy.hq@gmail.comまでご連絡ください。
            </p>
          </div>

          {/* 登録選手一覧 */}
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
            <p className="text-xs font-bold text-slate-700 border-b border-slate-200 pb-1 flex items-center gap-1.5">
              <Users className="w-4 h-4 text-slate-600" />
              登録選手一覧（合計 {registeredPlayers.length} 名）
            </p>
            <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
              {registeredPlayers.map(
                (p: { name: string; bibNumber: number }) => (
                  <div
                    key={p.bibNumber}
                    className="flex justify-between items-center bg-white p-2.5 rounded border border-slate-200 text-xs"
                  >
                    <span className="font-bold text-slate-900">
                      {p.name} 様
                    </span>
                    <span className="font-mono font-black text-slate-900 bg-slate-100 px-2 py-0.5 rounded">
                      仮No. {p.bibNumber}
                    </span>
                  </div>
                ),
              )}
            </div>
          </div>

          {/* PayPay送金手順案内 */}
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-950 space-y-2">
            <p className="font-bold flex items-center gap-1.5 text-amber-900 text-sm">
              <CreditCard className="w-4 h-4" />{' '}
              PayPay送金のお願い（参加確定手順）
            </p>
            <p className="leading-relaxed">
              合計参加費{' '}
              <strong className="text-base text-red-600 font-black">
                {totalFee.toLocaleString()} 円
              </strong>
              （1,500円 × {formData.players.length}
              名）を以下のPayPayID宛にご送金ください。
            </p>
            <div className="bg-white p-3 rounded border border-amber-300 font-mono text-xs space-y-1">
              <div>
                送金先PayPayID:{' '}
                <strong className="text-slate-900 select-all">
                  hayapaaaay
                </strong>
              </div>
              <div>
                メッセージ欄記入名:{' '}
                <strong className="text-slate-900">
                  {formData.representativeName}
                </strong>
              </div>
            </div>
            <p className="text-[11px] text-amber-800 leading-relaxed">
              ※ 送金時のメッセージ欄には必ず
              <strong>【代表者氏名: {formData.representativeName}】</strong>
              をご記入ください。送金確認をもって正式な受付完了となります。
            </p>
          </div>

          <Button
            type="button"
            onClick={() => router.push('/')}
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
            </div>
            <h1 className="text-xl font-black text-slate-900">
              第5回めんたいこ杯争奪弓道大会 参加エントリーフォーム
            </h1>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => router.push('/guidelines')}
            className="text-xs font-semibold"
          >
            <ArrowLeft className="w-3.5 h-3.5 mr-1" /> 要項へ戻る
          </Button>
        </div>

        <form onSubmit={handleSubmitEntry} className="space-y-8 text-xs">
          {/* 1. 参加申し込み代表者情報 */}
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
                  参加申し込み代表者 氏名{' '}
                  <span className="text-red-600">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="例: 明太太郎"
                  value={formData.representativeName}
                  onChange={(e) =>
                    handleRepresentativeChange(
                      'representativeName',
                      e.target.value,
                    )
                  }
                  className="w-full p-2.5 text-sm border border-slate-300 rounded-md bg-white focus:ring-2 focus:ring-slate-900 focus:outline-none font-bold text-slate-900"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  参加申し込み代表者 所属道場名 / 団体名
                </label>
                <input
                  type="text"
                  placeholder="例: 福岡弓道倶楽部"
                  value={formData.representativeOrganization}
                  onChange={(e) =>
                    handleRepresentativeChange(
                      'representativeOrganization',
                      e.target.value,
                    )
                  }
                  className="w-full p-2.5 text-sm border border-slate-300 rounded-md bg-white focus:ring-2 focus:ring-slate-900 focus:outline-none text-slate-900"
                />
              </div>

              <div>
                <label className="flex items-center gap-1 font-bold text-slate-700 mb-1">
                  <Mail className="w-3.5 h-3.5 text-slate-500" />
                  代表者メールアドレス <span className="text-red-600">*</span>
                </label>
                <input
                  type="email"
                  required
                  placeholder="example@domain.com"
                  value={formData.representativeEmail}
                  onChange={(e) =>
                    handleRepresentativeChange(
                      'representativeEmail',
                      e.target.value,
                    )
                  }
                  className="w-full p-2.5 text-sm border border-slate-300 rounded-md bg-white focus:ring-2 focus:ring-slate-900 focus:outline-none text-slate-900"
                />
              </div>

              <div>
                <label className="flex items-center gap-1 font-bold text-slate-700 mb-1">
                  <Phone className="w-3.5 h-3.5 text-slate-500" />
                  代表者携帯電話番号 <span className="text-red-600">*</span>
                </label>
                <input
                  type="tel"
                  required
                  placeholder="090-0000-0000"
                  value={formData.representativePhone}
                  onChange={(e) =>
                    handleRepresentativeChange(
                      'representativePhone',
                      e.target.value,
                    )
                  }
                  className="w-full p-2.5 text-sm border border-slate-300 rounded-md bg-white focus:ring-2 focus:ring-slate-900 focus:outline-none text-slate-900 font-mono"
                />
              </div>
            </div>
          </section>

          {/* 2. 運営に伝えたいこと（備考欄） */}
          <section className="space-y-1.5 p-5 bg-slate-50 border border-slate-200 rounded-lg">
            <label className="block font-bold text-slate-700 text-xs">
              運営に伝えたいこと（備考欄）
            </label>
            <p className="text-[11px] text-slate-500 mb-2">
              質問、連絡事項、配慮事項等があればご自由にご記入ください。
            </p>
            <textarea
              rows={3}
              placeholder="質問、連絡事項、配慮事項等があればご自由にご記入ください。"
              value={formData.notes}
              onChange={(e) =>
                handleRepresentativeChange('notes', e.target.value)
              }
              className="w-full p-3 text-sm border border-slate-300 rounded-md bg-white focus:ring-2 focus:ring-slate-900 focus:outline-none text-slate-900"
            />
          </section>

          {/* 3. 参加選手情報 */}
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
              {formData.players.map(
                (player: EntryPlayerItem, index: number) => (
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
                          placeholder="例: 明太花子"
                          value={player.name}
                          onChange={(e) =>
                            handlePlayerChange(index, 'name', e.target.value)
                          }
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
                          placeholder="例: めんたいはなこ"
                          value={player.nameKana}
                          onChange={(e) =>
                            handlePlayerChange(
                              index,
                              'nameKana',
                              e.target.value,
                            )
                          }
                          className="w-full p-2.5 text-sm border border-slate-300 rounded-md focus:ring-2 focus:ring-slate-900 focus:outline-none text-slate-900"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block font-bold text-slate-700 mb-1">
                          所作の選択 <span className="text-red-600">*</span>
                        </label>
                        <div className="grid grid-cols-2 gap-2">
                          {(['肌脱ぎ', '襷掛け'] as ShosaType[]).map(
                            (shosaOption: ShosaType) => (
                              <div
                                key={shosaOption}
                                onClick={() =>
                                  handlePlayerChange(
                                    index,
                                    'shosa',
                                    shosaOption,
                                  )
                                }
                                className={`p-2 border rounded-md text-center cursor-pointer font-bold transition-all text-xs ${
                                  player.shosa === shosaOption
                                    ? 'border-slate-900 bg-slate-900 text-white shadow-xs'
                                    : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                                }`}
                              >
                                {shosaOption}
                              </div>
                            ),
                          )}
                        </div>
                      </div>

                      <div>
                        <label className="flex items-center gap-1 font-bold text-slate-700 mb-1">
                          <Award className="w-3.5 h-3.5 text-amber-600" />
                          称号・段位 <span className="text-red-600">*</span>
                        </label>
                        <select
                          value={player.rankTitle}
                          onChange={(e) =>
                            handlePlayerChange(
                              index,
                              'rankTitle',
                              sanitizeRankTitle(e.target.value),
                            )
                          }
                          className="w-full p-2.5 text-xs border border-slate-300 rounded-md bg-white font-bold text-slate-900 focus:ring-2 focus:ring-slate-900"
                        >
                          <option value="段位は三段以下">段位は三段以下</option>
                          <option value="段位は四段以上">段位は四段以上</option>
                          <option value="称号を取得している">
                            称号を取得している
                          </option>
                        </select>
                      </div>
                    </div>

                    <div className="space-y-2 pt-1">
                      <label className="flex items-start gap-2.5 p-2.5 bg-slate-50 border border-slate-200 rounded-md cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={player.needsSupport}
                          onChange={(e) =>
                            handlePlayerChange(
                              index,
                              'needsSupport',
                              e.target.checked,
                            )
                          }
                          className="mt-0.5 rounded text-slate-900 focus:ring-slate-900"
                        />
                        <span className="text-slate-700 leading-relaxed text-[11px]">
                          本座での肌脱ぎ・襷掛けが不慣れなため、サポートの必要性があるので配慮を希望する
                        </span>
                      </label>

                      <label className="flex items-start gap-2.5 p-2.5 bg-amber-50/60 border border-amber-200 rounded-md cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={player.isStaffVolunteer}
                          onChange={(e) =>
                            handlePlayerChange(
                              index,
                              'isStaffVolunteer',
                              e.target.checked,
                            )
                          }
                          className="mt-0.5 rounded text-slate-900 focus:ring-slate-900"
                        />
                        <div className="space-y-1">
                          <span className="font-bold text-amber-950 text-xs">
                            大会運営スタッフ（半日）の協力が可能
                          </span>
                          <p className="text-[11px] text-amber-900 leading-relaxed">
                            可能の方には当日午前（AM）または午後（PM）のいずれか半日、競技運営業務のご協力を依頼させていただきます。
                          </p>
                          <p className="text-[11px] text-amber-900 leading-relaxed">
                            担当業務は、進行・的前・招集・記録・運営などです。運営委員会がお役目を設定させていただきます。
                          </p>
                          <p className="text-[11px] text-amber-800 leading-relaxed">
                            各係は複数名体制で担当するため、初めての方でも安心してご参加いただけます。ご所属の地区や道場における射会運営の実践練習としてもぜひご活用ください。
                          </p>
                          <p className="text-[10px] text-amber-700 font-semibold pt-0.5">
                            ※ご協力いただいた方には、些少ですが謝礼をご用意いたします。
                          </p>
                        </div>
                      </label>
                    </div>
                  </div>
                ),
              )}
            </div>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleAddPlayer}
              className="w-full text-xs font-bold border-dashed border-2 border-slate-300 py-3 text-slate-700 hover:bg-slate-50"
            >
              <UserPlus className="w-4 h-4 mr-1.5" />
              さらに別の参加選手を追加する
            </Button>
          </section>

          {/* 4. 参加費合計および送金手順案内 */}
          <section className="p-4 bg-slate-900 text-white rounded-lg space-y-3">
            <div className="flex justify-between items-center border-b border-slate-700 pb-2">
              <span className="text-xs text-slate-300">
                参加選手合計: <strong>{formData.players.length}</strong> 名 ×
                1,500円
              </span>
              <span className="text-xs font-bold text-amber-400">
                お支払い合計:{' '}
                <strong className="text-lg text-white font-black">
                  {totalFee.toLocaleString()}
                </strong>{' '}
                円
              </span>
            </div>
            <p className="text-[11px] text-slate-300 leading-relaxed">
              ※ 送信完了後、代表者様のお名前（
              {formData.representativeName || '代表者名'}
              ）をメッセージ欄に記載の上、PayPay送金先（ID:{' '}
              <strong className="text-white">hayapaaaay</strong>
              ）へご送金ください。
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
              ? 'エントリー登録処理中...'
              : `全 ${formData.players.length} 名の参加を申し込む（合計 ${totalFee.toLocaleString()} 円）`}
          </Button>
        </form>
      </div>
    </main>
  );
}
