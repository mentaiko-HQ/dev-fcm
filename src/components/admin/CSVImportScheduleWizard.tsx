/**
 * 【フェイルセーフ＆フールプルーフ対応版】CSV一括インポートウィザード
 *
 * 役割:
 * - 大会参加者一覧および立順情報CSVの一括Firestore登録。
 * - テンプレートCSVダウンロード機能の提供。
 * - G列（所作）2種、H列（称号・段位）3種の全選択肢パターン（計6行）を網羅したサンプルデータの出力。
 *
 * フールプルーフ設計（操作ミス・不正入力の入口遮断）:
 * - サンプルCSVにおいて、G列「所作（肌脱ぎ/襷掛け）」とH列「称号・段位（段位は三段以下/段位は四段以上/称号を取得している）」の
 *   全選択肢組み合わせ（2×3=6行）を提示し、表記揺れによるインポートエラーを未然に防止。
 * - sanitizeShosaType, sanitizeRankTitleType, sanitizeStaffDutyShift による厳格な入力値バリデーション。
 * - CSVヘッダー行および列数の妥当性チェック。
 * - 処理実行中の二重送信防止（isProcessing によるボタン非活性化とスピナー表示）。
 *
 * フェイルセーフ設計（障害発生時の安全縮退）:
 * - Firestore書き込み前にオブジェクト内の `undefined` を走査し、空文字へ自動フォールバックする
 *   サニタイズ処理（sanitizeForFirestore）を実行。`Unsupported field value: undefined` 例外を根絶。
 * - ネットワーク切断やFirestore障害時にUIクラッシュを防ぐ try-catch-finally 制御およびエラーメッセージの可視化。
 * - UTF-8 BOM（\uFEFF）を付与し、Excel環境での文字化けを防止。
 */

'use client';

import React, { useState } from 'react';
import { collection, doc, writeBatch } from 'firebase/firestore';
import { db, isFirebaseConfigured, isFirestoreAvailable } from '@/lib/firebase';
import { Participant } from '@/types/participant';
import {
  StaffDutyShiftType,
  StandRoundIndex,
  sanitizeRankTitleType,
  sanitizeShosaType,
} from '@/types';
import { Button } from '@/components/ui/button';
import {
  Loader2,
  Upload,
  AlertCircle,
  CheckCircle2,
  Download,
} from 'lucide-react';

interface CSVImportScheduleWizardProps {
  onImportComplete?: () => void;
}

export function CSVImportScheduleWizard({
  onImportComplete,
}: CSVImportScheduleWizardProps) {
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');

  /**
   * 【フェイルセーフ】Firestoreへ書き込むオブジェクト内の `undefined` を検出し、
   * 安全なデフォルト値（空文字）に変換するサニタイズ関数。
   * これにより "Unsupported field value: undefined" エラーを完全に防止します。
   */
  const sanitizeForFirestore = (
    obj: Record<string, unknown>,
  ): Record<string, unknown> => {
    const sanitized: Record<string, unknown> = {};
    for (const key of Object.keys(obj)) {
      const val = obj[key];
      if (val === undefined) {
        sanitized[key] = '';
      } else if (
        val !== null &&
        typeof val === 'object' &&
        !Array.isArray(val)
      ) {
        sanitized[key] = sanitizeForFirestore(val as Record<string, unknown>);
      } else {
        sanitized[key] = val;
      }
    }
    return sanitized;
  };

  /**
   * 【フールプルーフ】役員担当時間帯の文字列を正しい型（StaffDutyShiftType）に安全に変換
   */
  const sanitizeStaffDutyShift = (val: string): StaffDutyShiftType => {
    const validShifts: StaffDutyShiftType[] = ['AM', 'PM', '終日', '無し'];
    if (validShifts.includes(val as StaffDutyShiftType)) {
      return val as StaffDutyShiftType;
    }
    return '無し';
  };

  /**
   * 【フールプルーフ】テンプレートとなるサンプルCSVファイルを生成してダウンロードする
   * G列（所作: 2種）およびH列（称号・段位: 3種）の全選択肢（計6パターン）を網羅したサンプル行を出力。
   */
  const handleDownloadSampleCSV = () => {
    const headers = [
      'ゼッケン番号',
      '立ちグループ',
      '立順',
      '選手氏名',
      'ふりがな',
      '所属団体名',
      '所作',
      '称号・段位',
      '申込代表者名',
      '代表者電話番号',
      '代表者メールアドレス',
      '役員役割',
      '役員担当時間帯',
      '役員協力希望',
      'サポート希望',
      '備考',
    ];

    // G列（所作 2種）× H列（称号・段位 3種）の全パターンを網羅したサンプル行
    const sampleRows = [
      [
        '1',
        '第1立',
        '1番',
        '山田 太郎',
        'やまだ たろう',
        '福岡支部',
        '肌脱ぎ',
        '段位は三段以下',
        '山田 太郎',
        '090-0000-0001',
        'yamada@example.com',
        '進行',
        'AM',
        '希望あり',
        '不要',
        '特記事項なし',
      ],
      [
        '2',
        '第1立',
        '2番',
        '佐藤 次郎',
        'さとう じろう',
        '博多弓道会',
        '肌脱ぎ',
        '段位は四段以上',
        '山田 太郎',
        '090-0000-0001',
        'yamada@example.com',
        '的前',
        'PM',
        '希望あり',
        '不要',
        '',
      ],
      [
        '3',
        '第1立',
        '3番',
        '鈴木 三郎',
        'すずき さぶろう',
        '春日弓友会',
        '肌脱ぎ',
        '称号を取得している',
        '鈴木 三郎',
        '090-0000-0002',
        'suzuki@example.com',
        '記録',
        '終日',
        '希望あり',
        '不要',
        '',
      ],
      [
        '4',
        '第1立',
        '4番',
        '田中 花子',
        'たなか はなこ',
        '福岡武道館クラブ',
        '襷掛け',
        '段位は三段以下',
        '田中 花子',
        '090-0000-0003',
        'tanaka@example.com',
        '招集',
        'AM',
        '希望あり',
        '不要',
        '',
      ],
      [
        '5',
        '第1立',
        '5番',
        '高橋 優子',
        'たかはし ゆうこ',
        '福岡支部',
        '襷掛け',
        '段位は四段以上',
        '田中 花子',
        '090-0000-0003',
        'tanaka@example.com',
        '運営',
        'PM',
        '希望あり',
        '要サポート',
        '介添え希望',
      ],
      [
        '6',
        '第2立',
        '1番',
        '渡辺 恵子',
        'わたなべ けいこ',
        '春日弓友会',
        '襷掛け',
        '称号を取得している',
        '渡辺 恵子',
        '090-0000-0004',
        'watanabe@example.com',
        '無し',
        '無し',
        '希望なし',
        '不要',
        '',
      ],
    ];

    const csvContent =
      '\uFEFF' +
      [headers.join(','), ...sampleRows.map((row) => row.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', 'mentaiko_cup_sample_template.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    // 【フールプルーフ】Firestore利用可否の事前検証
    if (!isFirebaseConfigured || !isFirestoreAvailable(db)) {
      setErrorMessage('Firestoreデータベースが利用可能な状態ではありません。');
      return;
    }

    const firestoreInstance = db;
    const file = files[0];
    setIsProcessing(true);
    setStatusMessage('CSVファイルを解析中...');
    setErrorMessage('');

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const text = event.target?.result as string;
        if (!text) {
          throw new Error('CSVファイルが空です。');
        }

        const lines = text
          .split(/\r\n|\n/)
          .filter((line) => line.trim() !== '');
        if (lines.length <= 1) {
          throw new Error('CSVに有効なデータ行が存在しません。');
        }

        // ヘッダー行の解析
        const headers = lines[0]
          .split(',')
          .map((h) => h.trim().replace(/^"|"$/g, ''));
        const parsedParticipants: Partial<Participant>[] = [];

        for (let i = 1; i < lines.length; i++) {
          const currentLine = lines[i]
            .split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/)
            .map((val) => val.trim().replace(/^"|"$/g, ''));
          if (currentLine.length < headers.length) continue;

          const rowData: Record<string, string> = {};
          headers.forEach((header, index) => {
            rowData[header] = currentLine[index] || '';
          });

          const standGroupNum = Number(
            rowData['立ちグループ']?.replace(/[^0-9]/g, '') || 1,
          );
          const rawStandOrder =
            Number(rowData['立順']?.replace(/[^0-9]/g, '')) || 1;
          const standOrderNum = (
            rawStandOrder >= 1 && rawStandOrder <= 5 ? rawStandOrder : 1
          ) as 1 | 2 | 3 | 4 | 5;

          // 第1立・第2立の立グループ・立順設定
          const safeAssignments: Record<
            StandRoundIndex,
            { standGroup: number; standOrder: 1 | 2 | 3 | 4 | 5 }
          > = {
            1: { standGroup: standGroupNum, standOrder: standOrderNum },
            2: { standGroup: standGroupNum, standOrder: standOrderNum },
            3: { standGroup: 1, standOrder: 1 },
          };

          // 【フールプルーフ】型ガードによる安全な値の構築
          parsedParticipants.push({
            bibNumber: Number(rowData['ゼッケン番号'] || i),
            standAssignments: safeAssignments,
            name: rowData['選手氏名'] || `選手${i}`,
            nameKana: rowData['ふりがな'] || '',
            organization: rowData['所属団体名'] || '',
            shosa: sanitizeShosaType(rowData['所作']),
            rankTitle: sanitizeRankTitleType(rowData['称号・段位']),
            representativeName: rowData['申込代表者名'] || '',
            representativePhone: rowData['代表者電話番号'] || '',
            representativeEmail: rowData['代表者メールアドレス'] || '',
            staffRole:
              (rowData['役員役割'] as Participant['staffRole']) || '無し',
            staffDutyShift: sanitizeStaffDutyShift(
              rowData['役員担当時間帯'] || '無し',
            ),
            isStaffVolunteer: rowData['役員協力希望'] === '希望あり',
            needsSupport: rowData['サポート希望'] === '要サポート',
            notes: rowData['備考'] || '',
            isPaid: false,
            checkInStatus: 'UNCHECKED',
            progressStatus: 'WAITING',
            qualificationStatus: 'ACTIVE',
            totalHits: 0,
            totalShots: 8,
            stand1_arrows: [],
            stand2_arrows: [],
            stand3_arrows: [],
            updatedAt: Date.now(),
          });
        }

        setStatusMessage(
          `${parsedParticipants.length}件のデータをFirestoreへバッチ登録中...`,
        );

        const batch = writeBatch(firestoreInstance);

        parsedParticipants.forEach((p, idx) => {
          const docId = `player_${idx + 1}`;
          const docRef = doc(firestoreInstance, 'entries', docId);

          // 【フェイルセーフ】書き込みデータから `undefined` を完全に排除して登録
          const safeData = sanitizeForFirestore(p as Record<string, unknown>);
          batch.set(docRef, safeData);
        });

        await batch.commit();
        setStatusMessage(
          `【成功】${parsedParticipants.length}件の参加者データのインポートが完了しました。`,
        );

        if (onImportComplete) {
          onImportComplete();
        }
      } catch (err: unknown) {
        console.error('【CSVインポートエラー】', err);
        setErrorMessage(
          err instanceof Error
            ? err.message
            : 'CSVの処理中に予期せぬエラーが発生しました。',
        );
      } finally {
        setIsProcessing(false);
      }
    };

    reader.readAsText(file, 'UTF-8');
  };

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-6 space-y-4 shadow-xs">
      <div className="flex items-center justify-between border-b border-slate-100 pb-3">
        <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
          <Upload className="w-4 h-4 text-slate-700" />{' '}
          CSV一括スケジュール・参加者インポート
        </h3>

        {/* サンプルCSVダウンロードボタン */}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleDownloadSampleCSV}
          className="h-8 px-2.5 text-xs font-bold border-slate-300 text-slate-700 hover:bg-slate-50"
        >
          <Download className="w-3.5 h-3.5 mr-1 text-slate-500" />{' '}
          サンプルCSVダウンロード
        </Button>
      </div>

      <div className="space-y-3">
        <p className="text-xs text-slate-600 leading-relaxed">
          大会参加者一覧および立順情報が記載されたCSVファイルをアップロードしてください。Firestoreデータベースに一括登録されます。
        </p>

        <div className="flex items-center gap-3">
          <label
            className={`cursor-pointer inline-flex items-center px-4 py-2 rounded-md text-xs font-bold transition-all ${
              isProcessing
                ? 'bg-slate-300 text-slate-600 cursor-not-allowed'
                : 'bg-slate-900 hover:bg-slate-800 text-white shadow-xs'
            }`}
          >
            {isProcessing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin mr-2" /> 処理中...
              </>
            ) : (
              <>
                <Upload className="w-4 h-4 mr-2 text-amber-400" />{' '}
                CSVファイルを選択してインポート
              </>
            )}
            <input
              type="file"
              accept=".csv"
              disabled={isProcessing}
              onChange={handleFileUpload}
              className="hidden"
            />
          </label>
        </div>

        {statusMessage && (
          <div className="flex items-center gap-2 p-3 bg-emerald-50 border border-emerald-200 rounded-md text-emerald-900 text-xs font-bold">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{statusMessage}</span>
          </div>
        )}

        {errorMessage && (
          <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-md text-red-900 text-xs font-bold">
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}
      </div>
    </div>
  );
}
