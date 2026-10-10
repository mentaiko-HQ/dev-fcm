/**
 * 【大会当日専用 入場チェックイン受付コンソール】
 * /admin/reception パスに対応するページコンポーネント。
 * 大会役員PCにUSB接続されたQRコードリーダーによる高速自動入場受付機能、
 * 手動チェックイン機能、および「棄権（ABSENT）」登録・誤操作取り消し（Undo/復帰）機能を提供。
 * 白系統（ライトテーマ）デザイン。
 *
 * 役割:
 * 1. USB HID QRリーダーからの超高速キーストロークを欠落なく捕捉する非制御入力バッファ。
 * 2. 入力フォーカスが外れていてもスキャンを自動検知して処理（フォーカス自動復帰機構）。
 * 3. US配列スキャナーのキーズレ（*→", +→:, =→_, {→}）に対する自動逆変換および多層正規表現救済（qrDecoder）。
 * 4. 「未受付」「受付済」「棄権」「すべて」のリアルタイム4タブ切り替えとインクリメンタル検索。
 * 5. 体調不良・不参加選手に対する「棄権」登録および復帰機能。
 * 6. 受付状況、出席率のリアルタイムサマリー表示。
 * 7. スキャン解析ログ（受信生データ・復元データ・照合経路）の可視化。
 *
 * フールプルーフ設計（事故前・対人間）:
 * - ハードウェアスキャナーの言語設定（US/JIS）に関わらず、入力文字列を多層解析して自動照合。
 * - 棄権登録時は対象選手のゼッケンと氏名を明記した確認ダイアログ（confirm）を表示。
 * - 既に棄権登録されている選手のスキャン受付を遮断して警告発報。
 * - チャタリング防止のためのスキャンロック（1.2秒デバウンス）。
 * - 未入金選手の受付処理を遮断。
 *
 * フェイルセーフ設計（事故後・対故障）:
 * - QRスキャンが物理破損で読み取れない場合でも、全行に「手動受付」ボタンを配置して業務継続性を担保。
 * - 楽観的UI更新（Optimistic Update）とFirestoreロールバック。
 * - パスエイリアス解決不備を回避するため、相対パスインポートを採用。
 */

'use client';

import React, {
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback,
} from 'react';
import { useRouter } from 'next/navigation';
import {
  collection,
  doc,
  onSnapshot,
  query,
  updateDoc,
  serverTimestamp,
  orderBy,
} from 'firebase/firestore';
import { db, isFirebaseConfigured, isFirestoreAvailable } from '@/lib/firebase';
import {
  Participant,
  CheckInStatus,
  QualificationStatus,
  StandRoundIndex,
  StandOrderIndex,
  sanitizeStandGroup,
  sanitizeStandOrder,
  sanitizeShosaType,
  sanitizeRankTitleType,
} from '@/types';
import { playSuccessSound, playErrorSound } from '../../../lib/audio';
import {
  decodeAndMatchParticipant,
  QrDecodeResult,
} from '../../../lib/qrDecoder';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  ArrowLeft,
  Search,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Users,
  QrCode,
  Clock,
  RotateCcw,
  Volume2,
  UserCheck,
  UserX,
  UserMinus,
  Keyboard,
  Sparkles,
  Ban,
  Undo2,
  Bug,
  ShieldCheck,
} from 'lucide-react';

const DEBOUNCE_LOCK_MS = 1200;

function getStandOrderText(order: StandOrderIndex | null | undefined): string {
  if (!order) return '未設定';
  const labels: Record<number, string> = {
    1: '大前 (1番)',
    2: '二的 (2番)',
    3: '中 (3番)',
    4: '落前 (4番)',
    5: '落 (5番)',
  };
  return labels[order] || `${order}番`;
}

export default function ReceptionPage() {
  const router = useRouter();
  const isDbReady = isFirebaseConfigured && isFirestoreAvailable(db);

  const [participants, setParticipants] = useState<Participant[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(() => isDbReady);
  const [activeTab, setActiveTab] = useState<
    'UNCHECKED' | 'CHECKED_IN' | 'ABSENT' | 'ALL'
  >('UNCHECKED');
  const [searchTerm, setSearchTerm] = useState<string>('');

  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>(() =>
    !isDbReady ? 'Firebaseデータベースに接続されていません。' : '',
  );

  // デバッグ・解析結果表示ステート
  const [lastDecodeResult, setLastDecodeResult] =
    useState<QrDecodeResult | null>(null);

  // 直近操作選手（Undo・ハイライト用）
  const [lastActionParticipant, setLastActionParticipant] =
    useState<Participant | null>(null);
  const [lastActionType, setLastActionType] = useState<
    'CHECK_IN' | 'ABSENT' | null
  >(null);

  // USBスキャナー高速入力用の非制御Input参照
  const scanInputRef = useRef<HTMLInputElement>(null);
  const isScanLockedRef = useRef<boolean>(false);

  // 1. Firestore entries コレクションのリアルタイム購読
  useEffect(() => {
    if (!isFirebaseConfigured || !isFirestoreAvailable(db)) return;

    const q = query(collection(db, 'entries'), orderBy('bibNumber', 'asc'));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const loaded: Participant[] = [];
        snapshot.forEach((docSnap) => {
          const raw = docSnap.data();
          const rawAssignments = raw.standAssignments || {};

          const afternoonGroup = sanitizeStandGroup(
            rawAssignments[2]?.standGroup ??
              rawAssignments[3]?.standGroup ??
              null,
          );
          const afternoonOrder = sanitizeStandOrder(
            rawAssignments[2]?.standOrder ??
              rawAssignments[3]?.standOrder ??
              null,
          );

          const safeAssignments: Record<
            StandRoundIndex,
            { standGroup: number | null; standOrder: StandOrderIndex | null }
          > = {
            1: {
              standGroup: sanitizeStandGroup(
                rawAssignments[1]?.standGroup ?? null,
              ),
              standOrder: sanitizeStandOrder(
                rawAssignments[1]?.standOrder ?? null,
              ),
            },
            2: {
              standGroup: afternoonGroup,
              standOrder: afternoonOrder,
            },
            3: {
              standGroup: afternoonGroup,
              standOrder: afternoonOrder,
            },
          };

          loaded.push({
            id: docSnap.id,
            bibNumber:
              typeof raw.bibNumber === 'number'
                ? raw.bibNumber
                : Number(raw.bibNumber) || 1,
            name: typeof raw.name === 'string' ? raw.name : '選手名未設定',
            nameKana: typeof raw.nameKana === 'string' ? raw.nameKana : '',
            organization:
              typeof raw.organization === 'string' ? raw.organization : '',
            shosa: sanitizeShosaType(raw.shosa),
            rankTitle: sanitizeRankTitleType(raw.rankTitle),
            staffRole: raw.staffRole || '無し',
            staffDutyShift: raw.staffDutyShift || '無し',
            checkInStatus: (raw.checkInStatus as CheckInStatus) || 'UNCHECKED',
            checkInAt: typeof raw.checkInAt === 'number' ? raw.checkInAt : null,
            checkInMethod: raw.checkInMethod || null,
            isStaffVolunteer: Boolean(raw.isStaffVolunteer),
            needsSupport: Boolean(raw.needsSupport),
            standAssignments: safeAssignments,
            progressStatus: raw.progressStatus || 'WAITING',
            qualificationStatus:
              (raw.qualificationStatus as QualificationStatus) || 'ACTIVE',
            stand1_arrows: Array.isArray(raw.stand1_arrows)
              ? raw.stand1_arrows
              : [],
            stand2_arrows: Array.isArray(raw.stand2_arrows)
              ? raw.stand2_arrows
              : [],
            stand3_arrows: Array.isArray(raw.stand3_arrows)
              ? raw.stand3_arrows
              : [],
            isHayaHit: Boolean(raw.isHayaHit),
            totalHits:
              typeof raw.totalHits === 'number'
                ? raw.totalHits
                : Number(raw.totalHits) || 0,
            totalShots:
              typeof raw.totalShots === 'number'
                ? raw.totalShots
                : Number(raw.totalShots) || 8,
            isPerfect: Boolean(raw.isPerfect),
            enkinRank: typeof raw.enkinRank === 'number' ? raw.enkinRank : null,
            finalRank: typeof raw.finalRank === 'number' ? raw.finalRank : null,
            representativeName:
              typeof raw.representativeName === 'string'
                ? raw.representativeName
                : '',
            representativeEmail:
              typeof raw.representativeEmail === 'string'
                ? raw.representativeEmail
                : '',
            representativePhone:
              typeof raw.representativePhone === 'string'
                ? raw.representativePhone
                : '',
            representativeOrganization:
              typeof raw.representativeOrganization === 'string'
                ? raw.representativeOrganization
                : '',
            isPaid: Boolean(raw.isPaid),
            paidAt: typeof raw.paidAt === 'number' ? raw.paidAt : null,
            notes: typeof raw.notes === 'string' ? raw.notes : '',
            qrSentAt: typeof raw.qrSentAt === 'number' ? raw.qrSentAt : null,
            qrSentStatus: raw.qrSentStatus || 'UNSENT',
            qrSentError: raw.qrSentError || null,
          });
        });

        setParticipants(loaded);
        setIsLoading(false);
      },
      (err) => {
        console.error('【受付Firestore購読例外】:', err);
        setErrorMessage('参加者データの取得に失敗しました。');
        setIsLoading(false);
      },
    );

    return () => unsubscribe();
  }, []);

  // 2. USBスキャナー向けフォーカス自動維持機構
  const keepInputFocus = useCallback(() => {
    if (scanInputRef.current) {
      scanInputRef.current.focus();
    }
  }, []);

  useEffect(() => {
    keepInputFocus();
    const handleDocumentClick = () => {
      keepInputFocus();
    };
    document.addEventListener('click', handleDocumentClick);
    return () => document.removeEventListener('click', handleDocumentClick);
  }, [keepInputFocus]);

  // 3. 入場チェックイン実行処理
  const executeCheckIn = useCallback(
    async (targetParticipant: Participant, method: 'QR_SCAN' | 'MANUAL') => {
      if (!isFirebaseConfigured || !isFirestoreAvailable(db)) return;

      if (isScanLockedRef.current) return;
      isScanLockedRef.current = true;
      setIsProcessing(true);
      setErrorMessage('');

      if (
        targetParticipant.checkInStatus === 'ABSENT' ||
        targetParticipant.qualificationStatus === 'WITHDRAWN'
      ) {
        playErrorSound();
        setErrorMessage(
          `【棄権登録済】No.${targetParticipant.bibNumber} ${targetParticipant.name} 選手は「棄権」に設定されています。受付を行う場合は「棄権取り消し」を実行してください。`,
        );
        isScanLockedRef.current = false;
        setIsProcessing(false);
        return;
      }

      if (targetParticipant.checkInStatus === 'CHECKED_IN') {
        playErrorSound();
        const checkInTime = targetParticipant.checkInAt
          ? new Date(targetParticipant.checkInAt).toLocaleTimeString('ja-JP', {
              hour: '2-digit',
              minute: '2-digit',
            })
          : '受付済み';
        setErrorMessage(
          `【重複警告】No.${targetParticipant.bibNumber} ${targetParticipant.name} 選手は既に受付完了しています（受付時刻: ${checkInTime}）。`,
        );
        isScanLockedRef.current = false;
        setIsProcessing(false);
        return;
      }

      if (!targetParticipant.isPaid) {
        playErrorSound();
        setErrorMessage(
          `【入金未確認】No.${targetParticipant.bibNumber} ${targetParticipant.name} 選手は参加費が未納です。入金確認を行ってください。`,
        );
        isScanLockedRef.current = false;
        setIsProcessing(false);
        return;
      }

      const now = Date.now();
      const previousState = { ...targetParticipant };

      // 楽観的UI更新
      setParticipants((prev) =>
        prev.map((p) =>
          p.id === targetParticipant.id
            ? {
                ...p,
                checkInStatus: 'CHECKED_IN',
                checkInAt: now,
                checkInMethod: method,
                qualificationStatus: 'ACTIVE',
              }
            : p,
        ),
      );

      try {
        const docRef = doc(db, 'entries', targetParticipant.id);
        await updateDoc(docRef, {
          checkInStatus: 'CHECKED_IN',
          checkInAt: now,
          checkInMethod: method,
          qualificationStatus: 'ACTIVE',
          updatedAt: serverTimestamp(),
        });

        playSuccessSound();
        const updated: Participant = {
          ...targetParticipant,
          checkInStatus: 'CHECKED_IN',
          checkInAt: now,
          checkInMethod: method,
          qualificationStatus: 'ACTIVE',
        };
        setLastActionParticipant(updated);
        setLastActionType('CHECK_IN');
        setStatusMessage(
          `【受付完了】No.${targetParticipant.bibNumber} ${targetParticipant.name} 選手（${targetParticipant.organization || '無所属'}）の入場受付を完了しました。`,
        );

        setTimeout(() => setStatusMessage(''), 4500);
      } catch (err) {
        console.error('【受付更新例外】:', err);
        playErrorSound();
        setParticipants((prev) =>
          prev.map((p) => (p.id === targetParticipant.id ? previousState : p)),
        );
        setErrorMessage(
          '受付データの更新に失敗しました。通信状態を確認してください。',
        );
      } finally {
        setIsProcessing(false);
        setTimeout(() => {
          isScanLockedRef.current = false;
        }, DEBOUNCE_LOCK_MS);
      }
    },
    [],
  );

  // 4. 受付取り消し処理
  const handleRevertCheckIn = async (participant: Participant) => {
    if (!isFirebaseConfigured || !isFirestoreAvailable(db)) return;

    const confirmed = window.confirm(
      `No.${participant.bibNumber} ${participant.name} 選手の受付を取り消し、「未受付」に戻しますか？`,
    );
    if (!confirmed) return;

    setErrorMessage('');
    setIsProcessing(true);

    const previousState = { ...participant };

    setParticipants((prev) =>
      prev.map((p) =>
        p.id === participant.id
          ? {
              ...p,
              checkInStatus: 'UNCHECKED',
              checkInAt: null,
              checkInMethod: null,
            }
          : p,
      ),
    );

    try {
      const docRef = doc(db, 'entries', participant.id);
      await updateDoc(docRef, {
        checkInStatus: 'UNCHECKED',
        checkInAt: null,
        checkInMethod: null,
        updatedAt: serverTimestamp(),
      });

      setStatusMessage(
        `No.${participant.bibNumber} ${participant.name} 選手の受付を取り消しました。`,
      );
      if (lastActionParticipant?.id === participant.id) {
        setLastActionParticipant(null);
        setLastActionType(null);
      }
      setTimeout(() => setStatusMessage(''), 3000);
    } catch (err) {
      console.error('【受付取消例外】:', err);
      setParticipants((prev) =>
        prev.map((p) => (p.id === participant.id ? previousState : p)),
      );
      setErrorMessage('受付取消に失敗しました。通信環境を確認してください。');
    } finally {
      setIsProcessing(false);
    }
  };

  // 5. 棄権登録処理
  const handleMarkAbsent = async (participant: Participant) => {
    if (!isFirebaseConfigured || !isFirestoreAvailable(db)) return;

    const confirmed = window.confirm(
      `【棄権登録の確認】\nNo.${participant.bibNumber} ${participant.name} 選手（${participant.organization || '無所属'}）を「棄権」として処理しますか？\n\n※この操作により本日の競技資格が「棄権 (WITHDRAWN)」となりますが、後からいつでも取り消し・復帰が可能です。`,
    );
    if (!confirmed) return;

    setIsProcessing(true);
    setErrorMessage('');
    setStatusMessage('');

    const previousState = { ...participant };

    setParticipants((prev) =>
      prev.map((p) =>
        p.id === participant.id
          ? {
              ...p,
              checkInStatus: 'ABSENT',
              qualificationStatus: 'WITHDRAWN',
              checkInAt: null,
              checkInMethod: null,
            }
          : p,
      ),
    );

    try {
      const docRef = doc(db, 'entries', participant.id);
      await updateDoc(docRef, {
        checkInStatus: 'ABSENT',
        qualificationStatus: 'WITHDRAWN',
        checkInAt: null,
        checkInMethod: null,
        updatedAt: serverTimestamp(),
      });

      playErrorSound();
      const updated: Participant = {
        ...participant,
        checkInStatus: 'ABSENT',
        qualificationStatus: 'WITHDRAWN',
        checkInAt: null,
        checkInMethod: null,
      };
      setLastActionParticipant(updated);
      setLastActionType('ABSENT');
      setStatusMessage(
        `No.${participant.bibNumber} ${participant.name} 選手を「棄権」として登録しました。`,
      );
      setTimeout(() => setStatusMessage(''), 5000);
    } catch (err) {
      console.error('【棄権設定例外】:', err);
      setParticipants((prev) =>
        prev.map((p) => (p.id === participant.id ? previousState : p)),
      );
      setErrorMessage(
        '棄権ステータスの更新に失敗しました。通信環境を確認してください。',
      );
    } finally {
      setIsProcessing(false);
    }
  };

  // 6. 棄権取り消し（復帰）処理
  const handleRevertAbsent = async (participant: Participant) => {
    if (!isFirebaseConfigured || !isFirestoreAvailable(db)) return;

    const confirmed = window.confirm(
      `【棄権取り消しの確認】\nNo.${participant.bibNumber} ${participant.name} 選手の棄権を取り消し、「未受付（出場可能）」に復帰させますか？`,
    );
    if (!confirmed) return;

    setIsProcessing(true);
    setErrorMessage('');
    setStatusMessage('');

    const previousState = { ...participant };

    setParticipants((prev) =>
      prev.map((p) =>
        p.id === participant.id
          ? {
              ...p,
              checkInStatus: 'UNCHECKED',
              qualificationStatus: 'ACTIVE',
            }
          : p,
      ),
    );

    try {
      const docRef = doc(db, 'entries', participant.id);
      await updateDoc(docRef, {
        checkInStatus: 'UNCHECKED',
        qualificationStatus: 'ACTIVE',
        updatedAt: serverTimestamp(),
      });

      playSuccessSound();
      setStatusMessage(
        `No.${participant.bibNumber} ${participant.name} 選手の棄権を取り消し、「未受付」に復帰させました。`,
      );
      if (lastActionParticipant?.id === participant.id) {
        setLastActionParticipant(null);
        setLastActionType(null);
      }
      setTimeout(() => setStatusMessage(''), 3500);
    } catch (err) {
      console.error('【棄権復帰例外】:', err);
      setParticipants((prev) =>
        prev.map((p) => (p.id === participant.id ? previousState : p)),
      );
      setErrorMessage(
        '棄権取り消し処理に失敗しました。通信環境を確認してください。',
      );
    } finally {
      setIsProcessing(false);
    }
  };

  // 7. スキャン入力完了（Enter）ハンドラー
  const handleScanSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!scanInputRef.current) return;

      const rawText = scanInputRef.current.value;
      scanInputRef.current.value = '';

      if (!rawText.trim()) return;

      // 多層救済解析の実行
      const result = decodeAndMatchParticipant(rawText, participants);
      setLastDecodeResult(result);

      if (result.matchedParticipant) {
        setErrorMessage('');
        executeCheckIn(result.matchedParticipant, 'QR_SCAN');
      } else {
        playErrorSound();
        const previewText =
          rawText.length > 50 ? rawText.slice(0, 50) + '...' : rawText;
        setErrorMessage(
          `【照合エラー】スキャンデータ「${previewText}」に一致する選手が見つかりませんでした。（${result.debugMessage}）`,
        );
      }
    },
    [participants, executeCheckIn],
  );

  // 8. 集計統計
  const stats = useMemo(() => {
    const eligibleList = participants.filter(
      (p) =>
        p.qrSentStatus === 'SENT' ||
        p.checkInStatus === 'CHECKED_IN' ||
        p.checkInStatus === 'ABSENT',
    );
    const checkedInCount = eligibleList.filter(
      (p) => p.checkInStatus === 'CHECKED_IN',
    ).length;
    const absentCount = eligibleList.filter(
      (p) => p.checkInStatus === 'ABSENT',
    ).length;
    const uncheckedCount = eligibleList.filter(
      (p) => p.checkInStatus !== 'CHECKED_IN' && p.checkInStatus !== 'ABSENT',
    ).length;
    const totalCount = eligibleList.length;

    const effectiveTotal = totalCount - absentCount;
    const rate =
      effectiveTotal > 0
        ? Math.round((checkedInCount / effectiveTotal) * 100)
        : 0;

    return { checkedInCount, absentCount, uncheckedCount, totalCount, rate };
  }, [participants]);

  // 9. タブ・検索フィルタリング
  const filteredList = useMemo(() => {
    return participants.filter((p) => {
      const isEligible =
        p.qrSentStatus === 'SENT' ||
        p.checkInStatus === 'CHECKED_IN' ||
        p.checkInStatus === 'ABSENT';
      if (!isEligible) return false;

      if (activeTab === 'UNCHECKED') {
        if (p.checkInStatus === 'CHECKED_IN' || p.checkInStatus === 'ABSENT')
          return false;
      } else if (activeTab === 'CHECKED_IN') {
        if (p.checkInStatus !== 'CHECKED_IN') return false;
      } else if (activeTab === 'ABSENT') {
        if (p.checkInStatus !== 'ABSENT') return false;
      }

      if (searchTerm.trim() !== '') {
        const term = searchTerm.trim().toLowerCase();
        const matchesName = p.name.toLowerCase().includes(term);
        const matchesKana = p.nameKana.toLowerCase().includes(term);
        const matchesOrg = p.organization.toLowerCase().includes(term);
        const matchesBib = p.bibNumber.toString().includes(term);
        const matchesRep = p.representativeName.toLowerCase().includes(term);
        return (
          matchesName || matchesKana || matchesOrg || matchesBib || matchesRep
        );
      }
      return true;
    });
  }, [participants, activeTab, searchTerm]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex flex-col items-center justify-center p-8 text-slate-500 w-full">
        <Loader2 className="w-8 h-8 animate-spin mb-2 text-slate-900" />
        <span className="text-xs font-mono font-bold">
          大会受付コンソールを初期化中...
        </span>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-[#F8FAFC] text-slate-900 p-4 sm:p-6 lg:p-8 space-y-6 w-full select-none">
      {/* USB HID QRリーダー専用 非制御入力フォーム */}
      <form onSubmit={handleScanSubmit} className="sr-only">
        <input
          ref={scanInputRef}
          type="text"
          defaultValue=""
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          inputMode="url"
          tabIndex={-1}
        />
      </form>

      {/* ページヘッダー */}
      <div className="w-full flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white border border-slate-200/80 p-6 rounded-2xl shadow-sm">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold bg-slate-900 text-white px-3 py-1 rounded-full flex items-center gap-1.5 shadow-2xs">
              <QrCode className="w-3.5 h-3.5 text-amber-400" /> 大会当日
              入場受付
            </span>
            <span className="text-xs font-mono font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-md flex items-center gap-1">
              <Keyboard className="w-3.5 h-3.5 animate-pulse text-emerald-600" />{' '}
              USBスキャナー待受中
            </span>
          </div>
          <h1 className="text-xl md:text-2xl font-black text-slate-900 pt-1">
            受付バーコード / QRリーダーコンソール
          </h1>
          <p className="text-xs text-slate-500 font-medium">
            参加者のQRコードカードをリーダーで読み取ると即座に受付済みに切り替わります（US配列スキャナー自動復元対応）。
          </p>
        </div>

        <div className="flex items-center gap-2.5 self-start md:self-auto">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push('/admin/check')}
            className="text-xs bg-white border-slate-200 text-slate-700 hover:bg-slate-50 font-bold h-9 px-4 rounded-xl"
          >
            <ArrowLeft className="w-4 h-4 mr-1.5" />
            エントリー管理
          </Button>

          <Button
            type="button"
            onClick={() => keepInputFocus()}
            className="text-xs bg-slate-900 hover:bg-slate-800 text-white font-bold h-9 px-4 rounded-xl shadow-xs flex items-center gap-1.5"
          >
            <Volume2 className="w-4 h-4 text-amber-400" />
            スキャン入力復帰
          </Button>
        </div>
      </div>

      {/* サマリーメーターカード群 */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-2xs space-y-1">
          <span className="text-xs font-bold text-slate-500 flex items-center gap-1.5">
            <Users className="w-4 h-4 text-slate-600" /> 正式エントリー総数
          </span>
          <div className="text-2xl font-black text-slate-900 font-mono">
            {stats.totalCount}{' '}
            <span className="text-xs font-normal text-slate-400">名</span>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-2xs space-y-1">
          <span className="text-xs font-bold text-emerald-700 flex items-center gap-1.5">
            <UserCheck className="w-4 h-4 text-emerald-600" /> 受付完了
          </span>
          <div className="text-2xl font-black text-emerald-700 font-mono">
            {stats.checkedInCount}{' '}
            <span className="text-xs font-normal text-slate-400">
              / {stats.totalCount}
            </span>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-2xs space-y-1">
          <span className="text-xs font-bold text-amber-700 flex items-center gap-1.5">
            <UserX className="w-4 h-4 text-amber-600" /> 未受付（来場待ち）
          </span>
          <div className="text-2xl font-black text-amber-700 font-mono">
            {stats.uncheckedCount}{' '}
            <span className="text-xs font-normal text-slate-400">名</span>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-2xs space-y-1">
          <span className="text-xs font-bold text-rose-700 flex items-center gap-1.5">
            <Ban className="w-4 h-4 text-rose-600" /> 棄権 (欠席)
          </span>
          <div className="text-2xl font-black text-rose-700 font-mono">
            {stats.absentCount}{' '}
            <span className="text-xs font-normal text-slate-400">名</span>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-2xs space-y-1 col-span-2 lg:col-span-1">
          <span className="text-xs font-bold text-blue-700 flex items-center gap-1.5">
            <Sparkles className="w-4 h-4 text-blue-600" /> 実質出席率
          </span>
          <div className="text-2xl font-black text-blue-700 font-mono">
            {stats.rate}{' '}
            <span className="text-xs font-normal text-slate-400">%</span>
          </div>
        </div>
      </div>

      {/* ステータスバナー */}
      {statusMessage && (
        <div className="w-full p-4 bg-emerald-50 border border-emerald-300 rounded-xl text-emerald-900 text-xs font-bold flex items-center justify-between gap-3 shadow-2xs animate-in fade-in">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{statusMessage}</span>
          </div>
          {lastActionParticipant && lastActionType === 'ABSENT' && (
            <Button
              type="button"
              size="sm"
              disabled={isProcessing}
              onClick={() => handleRevertAbsent(lastActionParticipant)}
              className="h-7 px-3 bg-white hover:bg-slate-50 text-rose-700 border border-rose-300 font-bold text-xs rounded-lg shadow-2xs shrink-0 flex items-center gap-1"
            >
              <Undo2 className="w-3.5 h-3.5" />
              直前の棄権を取り消す (元に戻す)
            </Button>
          )}
        </div>
      )}

      {/* エラーバナー */}
      {errorMessage && (
        <div className="w-full p-4 bg-red-50 border border-red-200 rounded-xl text-red-800 text-xs space-y-2 shadow-2xs">
          <div className="flex items-start gap-2 font-bold">
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
            <span>{errorMessage}</span>
          </div>
        </div>
      )}

      {/* スキャン解析デバッグカード（解析成功・救済経路の可視化） */}
      {lastDecodeResult && (
        <div className="w-full p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-bold text-slate-700 flex items-center gap-1.5">
              <Bug className="w-3.5 h-3.5 text-slate-500" />
              最新スキャン解析ログ:
              <span
                className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                  lastDecodeResult.matchedParticipant
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-red-100 text-red-800'
                }`}
              >
                {lastDecodeResult.debugMessage}
              </span>
            </span>
            {lastDecodeResult.matchedParticipant && (
              <span className="text-[10px] text-slate-500 font-bold flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                照合経路: {lastDecodeResult.extractionMethod}
              </span>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px] font-mono">
            <div className="bg-white p-2 rounded border border-slate-200 truncate">
              <span className="text-slate-600 font-sans block text-[10px]">
                受信生データ (US配列化け):
              </span>
              <span className="text-slate-900 select-all">
                {lastDecodeResult.rawInput}
              </span>
            </div>
            <div className="bg-white p-2 rounded border border-slate-200 truncate">
              <span className="text-slate-600 font-sans block text-[10px]">
                復元・正規化後テキスト:
              </span>
              <span className="text-emerald-950 font-bold select-all">
                {lastDecodeResult.normalizedInput}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* 直近操作選手のハイライトカード */}
      {lastActionParticipant && lastActionType === 'CHECK_IN' && (
        <div className="w-full bg-white border-2 border-emerald-500 p-5 rounded-2xl shadow-md flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-xl bg-emerald-500 text-white flex flex-col items-center justify-center font-black shrink-0 shadow-sm">
              <span className="text-[10px] font-sans">No.</span>
              <span className="text-2xl font-mono leading-none">
                {lastActionParticipant.bibNumber}
              </span>
            </div>
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <span className="text-xs px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 font-bold border border-emerald-200">
                  受付完了
                </span>
                <span className="text-xs text-slate-500 font-mono">
                  {lastActionParticipant.checkInAt
                    ? new Date(
                        lastActionParticipant.checkInAt,
                      ).toLocaleTimeString('ja-JP')
                    : ''}
                </span>
              </div>
              <h2 className="text-xl font-black text-slate-900 flex items-center gap-2">
                {lastActionParticipant.name}
                <span className="text-xs font-normal text-slate-500 font-sans">
                  ({lastActionParticipant.organization || '無所属'})
                </span>
              </h2>
              <p className="text-xs text-slate-600">
                午前の部:{' '}
                <strong>
                  第{' '}
                  {lastActionParticipant.standAssignments[1]?.standGroup ??
                    '未'}{' '}
                  組 -{' '}
                  {getStandOrderText(
                    lastActionParticipant.standAssignments[1]?.standOrder,
                  )}
                </strong>
                {'  '}|{'  '}
                午後の部:{' '}
                <strong>
                  第{' '}
                  {lastActionParticipant.standAssignments[2]?.standGroup ??
                    '未'}{' '}
                  組 -{' '}
                  {getStandOrderText(
                    lastActionParticipant.standAssignments[2]?.standOrder,
                  )}
                </strong>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-end md:self-auto">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isProcessing}
              onClick={() => handleRevertCheckIn(lastActionParticipant)}
              className="text-xs bg-white border-slate-200 text-slate-700 hover:bg-slate-50 font-bold h-9"
            >
              <RotateCcw className="w-3.5 h-3.5 mr-1" /> 受付を取り消す
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={isProcessing}
              onClick={() => handleMarkAbsent(lastActionParticipant)}
              className="text-xs bg-rose-600 hover:bg-rose-500 text-white font-bold h-9 px-3 rounded-lg shadow-2xs"
            >
              <UserMinus className="w-3.5 h-3.5 mr-1" /> 棄権に変更
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setLastActionParticipant(null);
                setLastActionType(null);
              }}
              className="text-xs text-slate-500 hover:text-slate-800 h-9 px-3"
            >
              閉じる
            </Button>
          </div>
        </div>
      )}

      {/* タブ切り替え＆検索ツールバー */}
      <div className="w-full flex flex-col md:flex-row md:items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs">
        <div className="flex items-center gap-1.5 bg-slate-100 p-1.5 rounded-xl border border-slate-200 overflow-x-auto">
          <button
            type="button"
            onClick={() => setActiveTab('UNCHECKED')}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 shrink-0 ${
              activeTab === 'UNCHECKED'
                ? 'bg-white text-slate-900 shadow-2xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <UserX className="w-3.5 h-3.5 text-amber-600" />
            未受付 ({stats.uncheckedCount})
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('CHECKED_IN')}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 shrink-0 ${
              activeTab === 'CHECKED_IN'
                ? 'bg-white text-slate-900 shadow-2xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <UserCheck className="w-3.5 h-3.5 text-emerald-600" />
            受付済 ({stats.checkedInCount})
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('ABSENT')}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 shrink-0 ${
              activeTab === 'ABSENT'
                ? 'bg-white text-rose-700 shadow-2xs font-black'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Ban className="w-3.5 h-3.5 text-rose-600" />
            棄権 ({stats.absentCount})
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('ALL')}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 shrink-0 ${
              activeTab === 'ALL'
                ? 'bg-white text-slate-900 shadow-2xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            すべて ({stats.totalCount})
          </button>
        </div>

        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="選手名・ゼッケン・所属・担当者で即座に絞り込み..."
            className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 placeholder:text-slate-400 outline-none focus:bg-white focus:border-slate-900 font-medium transition-colors"
          />
        </div>
      </div>

      {/* 受付一覧テーブル */}
      <div className="w-full bg-white border border-slate-200/80 rounded-2xl overflow-hidden shadow-sm">
        <div className="w-full overflow-x-auto">
          <Table className="w-full min-w-[880px] text-xs">
            <TableHeader className="bg-slate-50/90 text-slate-700 border-b border-slate-200">
              <TableRow>
                <TableHead className="w-20 font-bold text-slate-900">
                  ゼッケン
                </TableHead>
                <TableHead className="font-bold text-slate-900">
                  選手情報 / 所属
                </TableHead>
                <TableHead className="font-bold text-slate-900">
                  午前の部 (第1立)
                </TableHead>
                <TableHead className="font-bold text-slate-900">
                  午後の部 (第2・3立)
                </TableHead>
                <TableHead className="font-bold text-slate-900 text-center w-36">
                  受付ステータス
                </TableHead>
                <TableHead className="font-bold text-slate-900 text-center w-56">
                  受付・棄権操作
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="divide-y divide-slate-100">
              {filteredList.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="py-16 text-center text-slate-400 font-medium"
                  >
                    該当する選手データはありません。
                  </TableCell>
                </TableRow>
              ) : (
                filteredList.map((p) => {
                  const isCheckedIn = p.checkInStatus === 'CHECKED_IN';
                  const isAbsent = p.checkInStatus === 'ABSENT';
                  const morningAssign = p.standAssignments[1];
                  const afternoonAssign = p.standAssignments[2];

                  return (
                    <TableRow
                      key={p.id}
                      className={`hover:bg-slate-50/70 transition-colors ${
                        isCheckedIn
                          ? 'bg-emerald-50/30'
                          : isAbsent
                            ? 'bg-rose-50/40'
                            : ''
                      }`}
                    >
                      <TableCell className="font-mono font-black text-sm text-slate-900 align-middle py-3.5">
                        No.{p.bibNumber}
                      </TableCell>

                      <TableCell className="align-middle py-3.5">
                        <div className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
                          {p.name}
                          {isAbsent && (
                            <span className="text-[10px] bg-rose-100 text-rose-800 border border-rose-300 px-2 py-0.5 rounded-full font-bold">
                              棄権
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-600 font-medium">
                          {p.organization || '無所属'}
                        </div>
                        <div className="text-[10px] text-slate-500">
                          {p.shosa} ・ {p.rankTitle}
                        </div>
                      </TableCell>

                      <TableCell className="align-middle py-3.5">
                        <div className="font-bold text-slate-800">
                          第 {morningAssign?.standGroup ?? '未'} 組
                        </div>
                        <div className="text-[11px] text-amber-700 font-mono font-bold">
                          {getStandOrderText(morningAssign?.standOrder)}
                        </div>
                      </TableCell>

                      <TableCell className="align-middle py-3.5">
                        <div className="font-bold text-slate-800">
                          第 {afternoonAssign?.standGroup ?? '未'} 組
                        </div>
                        <div className="text-[11px] text-slate-600 font-mono">
                          {getStandOrderText(afternoonAssign?.standOrder)}
                        </div>
                      </TableCell>

                      <TableCell className="text-center align-middle py-3.5">
                        {isCheckedIn ? (
                          <div className="inline-flex flex-col items-center">
                            <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-300">
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />{' '}
                              受付済
                            </span>
                            <span className="text-[10px] text-slate-400 font-mono mt-0.5">
                              {p.checkInAt
                                ? new Date(p.checkInAt).toLocaleTimeString(
                                    'ja-JP',
                                    {
                                      hour: '2-digit',
                                      minute: '2-digit',
                                    },
                                  )
                                : ''}
                              {p.checkInMethod === 'QR_SCAN'
                                ? ' (QR)'
                                : ' (手動)'}
                            </span>
                          </div>
                        ) : isAbsent ? (
                          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-[11px] font-bold bg-rose-50 text-rose-800 border border-rose-300">
                            <Ban className="w-3.5 h-3.5 text-rose-600" /> 棄権
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-[11px] font-bold bg-amber-50 text-amber-900 border border-amber-300">
                            <Clock className="w-3.5 h-3.5 text-amber-600" />{' '}
                            未受付
                          </span>
                        )}
                      </TableCell>

                      <TableCell className="text-center align-middle py-3.5">
                        <div className="flex items-center justify-center gap-2">
                          {isCheckedIn ? (
                            <>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={isProcessing}
                                onClick={() => handleRevertCheckIn(p)}
                                className="h-8 px-2.5 text-xs font-bold bg-white border-slate-300 text-slate-700 hover:bg-slate-50 rounded-lg shadow-2xs"
                                title="受付を取り消して未受付に戻す"
                              >
                                <RotateCcw className="w-3.5 h-3.5 mr-1" /> 取消
                              </Button>

                              <Button
                                type="button"
                                size="sm"
                                disabled={isProcessing}
                                onClick={() => handleMarkAbsent(p)}
                                className="h-8 px-2.5 text-xs font-bold bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 rounded-lg shadow-2xs"
                                title="受付を取り消して棄権に変更する"
                              >
                                <UserMinus className="w-3.5 h-3.5 mr-1" />{' '}
                                棄権へ
                              </Button>
                            </>
                          ) : isAbsent ? (
                            <Button
                              type="button"
                              size="sm"
                              disabled={isProcessing}
                              onClick={() => handleRevertAbsent(p)}
                              className="h-8 px-3.5 text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg shadow-sm border border-emerald-600 flex items-center gap-1.5"
                              title="誤って設定した棄権を取り消し、出場可能な「未受付」に戻す"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                              棄権を取り消す (復帰)
                            </Button>
                          ) : (
                            <>
                              <Button
                                type="button"
                                size="sm"
                                disabled={isProcessing}
                                onClick={() => executeCheckIn(p, 'MANUAL')}
                                className="h-8 px-3 text-xs font-bold bg-slate-900 hover:bg-slate-800 text-white rounded-lg shadow-2xs"
                                title="手動で入場受付を完了する"
                              >
                                <UserCheck className="w-3.5 h-3.5 mr-1 text-emerald-400" />{' '}
                                受付する
                              </Button>

                              <Button
                                type="button"
                                size="sm"
                                disabled={isProcessing}
                                onClick={() => handleMarkAbsent(p)}
                                className="h-8 px-2.5 text-xs font-bold bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 rounded-lg shadow-2xs"
                                title="この選手を棄権（欠席）として登録する"
                              >
                                <Ban className="w-3.5 h-3.5 mr-1" /> 棄権
                              </Button>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </main>
  );
}
