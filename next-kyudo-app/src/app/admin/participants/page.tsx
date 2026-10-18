/**
 * 【エントリー選手データ修正専用コンソールページ】
 * /admin/participants パスに対応するページコンポーネント。
 *
 * 役割:
 * - PC・タブレット端末での高効率操作に特化し、画面横幅100%（全幅展開）で表示。
 * - 【選手数無制限対応】ページネーション制限や上限カットを排除し、登録全選手を無制限に表示・個別修正。
 * - 参加選手属性（ゼッケン番号、氏名、ふりがな、所属団体、所作区分、称号・段位、配慮サポート希望、役員役割、役員シフト、備考）の確認・個別修正。
 * - 各選手データのFirestore個別削除機能（確認モーダル・ローディング付き）。
 * - 申込担当者（代表者氏名、メールアドレス）の表示。
 * - 組番号・立順（射位）の編集UIを排除し、誤操作による編成事故を防止（立順編成は /admin/check で実施）。
 *
 * フールプルーフ設計（操作ミス・二重実行・誤削除の入口遮断）:
 * - 差分検知（Dirty判定）により、各項目を変更した選手のみ保存ボタンをアクティブ化。未変更の選手は保存ボタンを非活性化。
 * - アクティブな保存ボタン（未保存の変更）が1件でも存在する場合、全項目のソート操作を完全ロック（disabled）し、意図せぬ並び順変更による誤入力を防止。
 * - 削除ボタン押下時に即座に削除せず、専用の確認モーダルを表示して選手名・ゼッケン番号を明示再確認。
 * - ゼッケン番号の重複をリアルタイムに検知し、重複時は警告表示とともに保存処理をブロック。
 * - 各選手の保存処理・削除処理中はボタンを非活性化（disabled）およびスピナー表示し、多重送信を防止。
 * - StaffDutyShiftType の型定義に厳格準拠。
 *
 * フェイルセーフ設計（障害時の安全縮退）:
 * - useRef による最新基準データ（originalParticipantsMapRef）の保持により、useEffectの依存関係を安定化しつつ、
 *   リモート更新時でも編集中（Dirty状態）の選手データを上書きせずローカル入力を保護。
 * - 更新・削除処理の例外を捕捉し、通信切断時でもクラッシュせずインラインエラー通知を表示。
 * - 更新時に既存の立順配置データ（standAssignments）やフラグ（isHayaHit, isSokuchu 等）を破壊せず完全に維持。
 */

'use client';

import React, {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
} from 'react';
import { useRouter } from 'next/navigation';
import {
  collection,
  doc,
  onSnapshot,
  query,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  orderBy,
} from 'firebase/firestore';
import { db, isFirebaseConfigured, isFirestoreAvailable } from '@/lib/firebase';
import {
  Participant,
  StandRoundIndex,
  StaffRoleType,
  StaffDutyShiftType,
  ShosaType,
  RankTitleType,
  StandOrderIndex,
  sanitizeStandOrder,
  sanitizeStandGroup,
} from '@/types';
import { Button } from '@/components/ui/button';
import {
  ArrowLeft,
  UserCog,
  Save,
  Trash2,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Users,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Hash,
  AlertTriangle,
  Search,
  Award,
  Sparkles,
  Mail,
  X,
  Lock,
} from 'lucide-react';

type SortKey =
  | 'bibNumber'
  | 'name'
  | 'organization'
  | 'shosa'
  | 'rankTitle'
  | 'staffRole'
  | 'staffDutyShift';

type SortDirection = 'asc' | 'desc';

const ROLE_PRIORITY: Record<StaffRoleType, number> = {
  進行: 1,
  的前: 2,
  招集: 3,
  記録: 4,
  カメラマン: 5,
  運営: 6,
  無し: 7,
};

const SHIFT_PRIORITY: Record<StaffDutyShiftType, number> = {
  午前のみ: 1,
  午後のみ: 2,
  終日: 3,
  無し: 4,
};

/**
 * 選手の編集対象プロパティが元データと一致しているかを判定するヘルパー関数
 */
function isParticipantUnchanged(
  current: Participant,
  original: Participant,
): boolean {
  return (
    current.bibNumber === original.bibNumber &&
    current.name.trim() === original.name.trim() &&
    current.nameKana.trim() === original.nameKana.trim() &&
    current.organization.trim() === original.organization.trim() &&
    current.shosa === original.shosa &&
    current.rankTitle === original.rankTitle &&
    current.staffRole === original.staffRole &&
    current.staffDutyShift === original.staffDutyShift &&
    Boolean(current.needsSupport) === Boolean(original.needsSupport) &&
    current.notes.trim() === original.notes.trim()
  );
}

export default function ParticipantsManagementPage() {
  const router = useRouter();

  const isDbReady = isFirebaseConfigured && isFirestoreAvailable(db);

  // 画面編集用ステート
  const [participants, setParticipants] = useState<Participant[]>([]);

  // 基準データ管理（useRefで最新値を保持し、useEffectの依存関係を安定化）
  const originalParticipantsMapRef = useRef<Map<string, Participant>>(
    new Map(),
  );
  const [originalParticipantsMap, setOriginalParticipantsMap] = useState<
    Map<string, Participant>
  >(new Map());

  const [isLoading, setIsLoading] = useState<boolean>(() => isDbReady);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Participant | null>(null);
  const [successMessage, setSuccessMessage] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>(() =>
    !isDbReady
      ? 'Firebaseデータベースに接続されていません。設定を確認してください。'
      : '',
  );

  const [searchTerm, setSearchTerm] = useState<string>('');
  const [sortKey, setSortKey] = useState<SortKey>('bibNumber');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  // Firestore entries コレクションのリアルタイム同期（全件・無制限）
  useEffect(() => {
    if (!isFirebaseConfigured || !isFirestoreAvailable(db)) {
      return;
    }

    const q = query(collection(db, 'entries'), orderBy('bibNumber', 'asc'));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const loaded: Participant[] = [];
        const loadedMap = new Map<string, Participant>();

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

          const item: Participant = {
            id: docSnap.id,
            bibNumber:
              typeof raw.bibNumber === 'number'
                ? raw.bibNumber
                : Number(raw.bibNumber) || 1,
            name: typeof raw.name === 'string' ? raw.name : '選手名未設定',
            nameKana: typeof raw.nameKana === 'string' ? raw.nameKana : '',
            organization:
              typeof raw.organization === 'string' ? raw.organization : '',
            shosa: raw.shosa === '襷掛け' ? '襷掛け' : '肌脱ぎ',
            rankTitle:
              raw.rankTitle === '称号を取得している' ||
              raw.rankTitle === '段位は四段以上' ||
              raw.rankTitle === '段位は三段以下'
                ? raw.rankTitle
                : '段位は三段以下',
            staffRole: raw.staffRole || '無し',
            staffDutyShift:
              raw.staffDutyShift === '午前のみ' ||
              raw.staffDutyShift === '午後のみ' ||
              raw.staffDutyShift === '終日' ||
              raw.staffDutyShift === '無し'
                ? raw.staffDutyShift
                : '無し',
            checkInStatus: raw.checkInStatus || 'UNCHECKED',
            checkInAt: typeof raw.checkInAt === 'number' ? raw.checkInAt : null,
            isStaffVolunteer: Boolean(raw.isStaffVolunteer),
            needsSupport: Boolean(raw.needsSupport),
            standAssignments: safeAssignments,
            progressStatus: raw.progressStatus || 'WAITING',
            qualificationStatus: raw.qualificationStatus || 'ACTIVE',
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
            isSokuchu: Boolean(raw.isSokuchu), // ★ここでプロパティを追加・マッピング
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
            qrSentStatus: raw.qrSentStatus || 'UNSENT',
            qrSentAt: typeof raw.qrSentAt === 'number' ? raw.qrSentAt : null,
            qrSentError: raw.qrSentError || null,
            agreedAt:
              typeof raw.agreedAt === 'number' ? raw.agreedAt : undefined,
            updatedAt:
              typeof raw.updatedAt === 'number' ? raw.updatedAt : undefined,
            userId: typeof raw.userId === 'string' ? raw.userId : undefined,
          };

          loaded.push(item);
          loadedMap.set(item.id, { ...item });
        });

        // 基準Mapの同期
        originalParticipantsMapRef.current = loadedMap;
        setOriginalParticipantsMap(loadedMap);

        // フェイルセーフ: 編集中（Dirty状態）の選手データは上書きせずローカル入力を保護
        setParticipants((prev) => {
          if (prev.length === 0) return loaded;

          return loaded.map((remoteItem) => {
            const localItem = prev.find((p) => p.id === remoteItem.id);
            if (!localItem) return remoteItem;

            const prevOriginal = originalParticipantsMapRef.current.get(
              remoteItem.id,
            );
            if (
              prevOriginal &&
              !isParticipantUnchanged(localItem, prevOriginal)
            ) {
              return localItem;
            }

            return remoteItem;
          });
        });

        setIsLoading(false);
      },
      (err) => {
        console.error('【Firestore購読エラー】:', err);
        setErrorMessage('参加者データの読み込みに失敗しました。');
        setIsLoading(false);
      },
    );

    return () => unsubscribe();
  }, [isDbReady]);

  /**
   * 各行の変更有無（Dirty判定）
   */
  const checkIsDirty = useCallback(
    (participant: Participant): boolean => {
      const original = originalParticipantsMap.get(participant.id);
      if (!original) return false;
      return !isParticipantUnchanged(participant, original);
    },
    [originalParticipantsMap],
  );

  /**
   * 未保存の変更がある選手が1名以上存在するかどうか
   */
  const hasUnsavedChanges = useMemo(() => {
    return participants.some((p) => checkIsDirty(p));
  }, [participants, checkIsDirty]);

  // 重複ゼッケン番号の検知
  const duplicateBibNumbers = useMemo(() => {
    const counts = new Map<number, number>();
    participants.forEach((p) => {
      counts.set(p.bibNumber, (counts.get(p.bibNumber) || 0) + 1);
    });
    const duplicates = new Set<number>();
    counts.forEach((count, bib) => {
      if (count > 1) {
        duplicates.add(bib);
      }
    });
    return duplicates;
  }, [participants]);

  // フィルタリングおよびソート（全件・無制限対象）
  const filteredAndSortedParticipants = useMemo(() => {
    const filtered = participants.filter((p) => {
      if (!searchTerm.trim()) return true;
      const term = searchTerm.trim().toLowerCase();
      return (
        p.name.toLowerCase().includes(term) ||
        p.nameKana.toLowerCase().includes(term) ||
        p.organization.toLowerCase().includes(term) ||
        p.bibNumber.toString().includes(term) ||
        p.representativeName.toLowerCase().includes(term) ||
        p.representativeEmail.toLowerCase().includes(term) ||
        p.notes.toLowerCase().includes(term)
      );
    });

    filtered.sort((a, b) => {
      let comparison = 0;

      switch (sortKey) {
        case 'bibNumber':
          comparison = a.bibNumber - b.bibNumber;
          break;
        case 'name':
          comparison = a.nameKana.localeCompare(b.nameKana, 'ja');
          break;
        case 'organization':
          comparison = a.organization.localeCompare(b.organization, 'ja');
          break;
        case 'shosa':
          comparison = a.shosa.localeCompare(b.shosa, 'ja');
          break;
        case 'rankTitle':
          comparison = a.rankTitle.localeCompare(b.rankTitle, 'ja');
          break;
        case 'staffRole': {
          const pA = ROLE_PRIORITY[a.staffRole] ?? 99;
          const pB = ROLE_PRIORITY[b.staffRole] ?? 99;
          comparison = pA - pB;
          break;
        }
        case 'staffDutyShift': {
          const pA = SHIFT_PRIORITY[a.staffDutyShift] ?? 99;
          const pB = SHIFT_PRIORITY[b.staffDutyShift] ?? 99;
          comparison = pA - pB;
          break;
        }
        default:
          comparison = a.bibNumber - b.bibNumber;
          break;
      }

      if (comparison === 0) {
        comparison = a.bibNumber - b.bibNumber;
      }

      return sortDirection === 'asc' ? comparison : -comparison;
    });

    return filtered;
  }, [participants, searchTerm, sortKey, sortDirection]);

  /**
   * ソート切り替えハンドラー（フールプルーフ: 未保存時は操作を遮断）
   */
  const handleToggleSort = (key: SortKey) => {
    if (hasUnsavedChanges) return;

    if (sortKey === key) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDirection('asc');
    }
  };

  const handleChangeBibNumber = (id: string, rawVal: string) => {
    const num = parseInt(rawVal, 10);
    const validBib = isNaN(num) || num < 1 ? 1 : num;

    setParticipants((prev) =>
      prev.map((p) => (p.id === id ? { ...p, bibNumber: validBib } : p)),
    );
  };

  const handleChangeField = (
    id: string,
    field: 'name' | 'nameKana' | 'organization' | 'notes',
    value: string,
  ) => {
    setParticipants((prev) =>
      prev.map((p) => (p.id === id ? { ...p, [field]: value } : p)),
    );
  };

  const handleChangeSelectField = (
    id: string,
    field:
      | 'shosa'
      | 'rankTitle'
      | 'staffRole'
      | 'staffDutyShift'
      | 'needsSupport',
    value: unknown,
  ) => {
    setParticipants((prev) =>
      prev.map((p) => (p.id === id ? { ...p, [field]: value } : p)),
    );
  };

  /**
   * 選手個別保存ハンドラー
   */
  const handleUpdateParticipant = async (participant: Participant) => {
    if (!isFirebaseConfigured || !isFirestoreAvailable(db)) return;

    if (duplicateBibNumbers.has(participant.bibNumber)) {
      setErrorMessage(
        `ゼッケンNo.${participant.bibNumber} が他の選手と重複しています。一意の番号に修正してください。`,
      );
      return;
    }

    if (!participant.name.trim()) {
      setErrorMessage(
        `ゼッケンNo.${participant.bibNumber} の選手氏名が入力されていません。`,
      );
      return;
    }

    setSavingId(participant.id);
    setErrorMessage('');

    try {
      const docRef = doc(db, 'entries', participant.id);
      await updateDoc(docRef, {
        bibNumber: participant.bibNumber,
        name: participant.name.trim(),
        nameKana: participant.nameKana.trim(),
        organization: participant.organization.trim(),
        shosa: participant.shosa,
        rankTitle: participant.rankTitle,
        needsSupport: participant.needsSupport,
        staffRole: participant.staffRole,
        staffDutyShift: participant.staffDutyShift,
        notes: participant.notes.trim(),
        updatedAt: serverTimestamp(),
      });

      const updatedParticipant: Participant = {
        ...participant,
        name: participant.name.trim(),
        nameKana: participant.nameKana.trim(),
        organization: participant.organization.trim(),
        notes: participant.notes.trim(),
      };

      originalParticipantsMapRef.current.set(
        participant.id,
        updatedParticipant,
      );
      setOriginalParticipantsMap(new Map(originalParticipantsMapRef.current));

      setSuccessMessage(
        `ゼッケンNo.${participant.bibNumber} ${participant.name} 選手の登録情報を更新しました。`,
      );
      setTimeout(() => setSuccessMessage(''), 2500);
    } catch (err: unknown) {
      console.error('【選手情報更新エラー】:', err);
      setErrorMessage('更新に失敗しました。通信環境を確認してください。');
    } finally {
      setSavingId(null);
    }
  };

  /**
   * 選手削除実行ハンドラー
   */
  const handleConfirmDelete = async () => {
    if (!deleteTarget || !isFirebaseConfigured || !isFirestoreAvailable(db))
      return;

    setDeletingId(deleteTarget.id);
    setErrorMessage('');

    try {
      const docRef = doc(db, 'entries', deleteTarget.id);
      await deleteDoc(docRef);

      originalParticipantsMapRef.current.delete(deleteTarget.id);
      setOriginalParticipantsMap(new Map(originalParticipantsMapRef.current));

      setSuccessMessage(
        `ゼッケンNo.${deleteTarget.bibNumber} ${deleteTarget.name} 選手のデータを削除しました。`,
      );
      setTimeout(() => setSuccessMessage(''), 2500);
      setDeleteTarget(null);
    } catch (err: unknown) {
      console.error('【選手削除エラー】:', err);
      setErrorMessage('削除処理に失敗しました。通信環境を確認してください。');
    } finally {
      setDeletingId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center p-8 text-slate-500 w-full">
        <Loader2 className="w-8 h-8 animate-spin mb-2 text-slate-900" />
        <span className="text-xs font-mono font-bold">
          参加選手データを取得中...
        </span>
      </div>
    );
  }

  return (
    <main className="p-4 sm:p-6 lg:p-8 space-y-6 w-full text-slate-900">
      <div className="w-full flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white border border-slate-200/80 p-6 rounded-2xl shadow-sm">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold bg-slate-900 text-white px-3 py-1 rounded-full flex items-center gap-1 shadow-2xs">
              <UserCog className="w-3.5 h-3.5 text-amber-400" /> 参加者名簿管理
            </span>
            <span className="text-xs font-semibold text-slate-600 bg-slate-100 px-2.5 py-0.5 rounded-md">
              エントリー属性修正・データ管理
            </span>
          </div>
          <h1 className="text-xl md:text-2xl font-black text-slate-900 flex items-center gap-2 pt-1">
            <Users className="w-6 h-6 text-slate-700" />
            エントリー参加選手データ修正コンソール
          </h1>
          <p className="text-xs text-slate-500 font-medium">
            選手名、ふりがな、所属団体、所作区分、称号・段位、配慮事項、役員シフト、ゼッケン番号の修正および登録削除を行えます。（※立ち順編成は「/admin/check」で行います）
          </p>
        </div>

        <Button
          type="button"
          variant="outline"
          onClick={() => router.push('/admin')}
          className="text-xs bg-white border-slate-200 text-slate-700 hover:bg-slate-50 font-bold self-start md:self-auto h-9"
        >
          <ArrowLeft className="w-3.5 h-3.5 mr-1" />
          本部ダッシュボードへ戻る
        </Button>
      </div>

      {successMessage && (
        <div className="w-full p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs font-bold flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{successMessage}</span>
        </div>
      )}

      {errorMessage && (
        <div className="w-full p-3.5 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs font-bold flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
          <span>{errorMessage}</span>
        </div>
      )}

      {hasUnsavedChanges && (
        <div className="w-full p-3.5 bg-amber-50 border border-amber-300 rounded-xl text-amber-950 text-xs font-bold flex items-center gap-2 shadow-2xs">
          <Lock className="w-4 h-4 text-amber-700 shrink-0" />
          <span>
            未保存の修正内容があります。誤入力を防ぐため、変更を「保存」するまで項目のソート機能は一時的に無効化されています。
          </span>
        </div>
      )}

      {duplicateBibNumbers.size > 0 && (
        <div className="w-full p-4 bg-red-50 border border-red-200 rounded-xl text-red-900 text-xs flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <p className="font-bold text-red-800">
              ゼッケン番号の重複を検知しました（重複番号:{' '}
              {Array.from(duplicateBibNumbers).join(', ')}）
            </p>
            <p className="text-[11px] text-red-700">
              同一のゼッケン番号を持つ選手は保存できません。それぞれ一意の番号に修正してください。
            </p>
          </div>
        </div>
      )}

      <div className="w-full bg-white border border-slate-200/80 p-5 rounded-2xl shadow-sm space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div className="relative flex-1 max-w-lg">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="選手名・ふりがな・所属・担当者名・メール・ゼッケン・備考で検索..."
              className="w-full pl-9 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 placeholder:text-slate-400 outline-none focus:bg-white focus:border-slate-900 font-medium transition-colors"
            />
          </div>
          <span className="text-[11px] font-mono text-slate-500 shrink-0">
            表示件数:{' '}
            <strong className="text-slate-900 font-bold">
              {filteredAndSortedParticipants.length}
            </strong>{' '}
            / {participants.length} 名
          </span>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
              <ArrowUpDown className="w-4 h-4 text-slate-700" />
              項目ソート切り替え
              {hasUnsavedChanges && (
                <span className="text-[10px] text-amber-800 font-normal ml-2 flex items-center gap-1">
                  <Lock className="w-3 h-3 text-amber-700" />{' '}
                  （未保存の変更があるためロック中）
                </span>
              )}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={hasUnsavedChanges}
              onClick={() => handleToggleSort('bibNumber')}
              className={`text-xs h-8 px-3 font-bold transition-all rounded-lg ${
                hasUnsavedChanges
                  ? 'opacity-40 cursor-not-allowed bg-slate-100 text-slate-400 border-slate-200'
                  : sortKey === 'bibNumber'
                    ? 'bg-slate-900 text-white border-slate-900 shadow-2xs'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              <Hash className="w-3.5 h-3.5 mr-1" />
              ゼッケン
              {sortKey === 'bibNumber' &&
                (sortDirection === 'asc' ? (
                  <ArrowUp className="w-3.5 h-3.5 ml-1" />
                ) : (
                  <ArrowDown className="w-3.5 h-3.5 ml-1" />
                ))}
            </Button>

            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={hasUnsavedChanges}
              onClick={() => handleToggleSort('name')}
              className={`text-xs h-8 px-3 font-bold transition-all rounded-lg ${
                hasUnsavedChanges
                  ? 'opacity-40 cursor-not-allowed bg-slate-100 text-slate-400 border-slate-200'
                  : sortKey === 'name'
                    ? 'bg-slate-900 text-white border-slate-900 shadow-2xs'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              選手名 (50音)
              {sortKey === 'name' &&
                (sortDirection === 'asc' ? (
                  <ArrowUp className="w-3.5 h-3.5 ml-1" />
                ) : (
                  <ArrowDown className="w-3.5 h-3.5 ml-1" />
                ))}
            </Button>

            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={hasUnsavedChanges}
              onClick={() => handleToggleSort('organization')}
              className={`text-xs h-8 px-3 font-bold transition-all rounded-lg ${
                hasUnsavedChanges
                  ? 'opacity-40 cursor-not-allowed bg-slate-100 text-slate-400 border-slate-200'
                  : sortKey === 'organization'
                    ? 'bg-slate-900 text-white border-slate-900 shadow-2xs'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              所属団体
              {sortKey === 'organization' &&
                (sortDirection === 'asc' ? (
                  <ArrowUp className="w-3.5 h-3.5 ml-1" />
                ) : (
                  <ArrowDown className="w-3.5 h-3.5 ml-1" />
                ))}
            </Button>

            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={hasUnsavedChanges}
              onClick={() => handleToggleSort('shosa')}
              className={`text-xs h-8 px-3 font-bold transition-all rounded-lg ${
                hasUnsavedChanges
                  ? 'opacity-40 cursor-not-allowed bg-slate-100 text-slate-400 border-slate-200'
                  : sortKey === 'shosa'
                    ? 'bg-slate-900 text-white border-slate-900 shadow-2xs'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              所作 (肌脱ぎ/襷)
              {sortKey === 'shosa' &&
                (sortDirection === 'asc' ? (
                  <ArrowUp className="w-3.5 h-3.5 ml-1" />
                ) : (
                  <ArrowDown className="w-3.5 h-3.5 ml-1" />
                ))}
            </Button>

            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={hasUnsavedChanges}
              onClick={() => handleToggleSort('rankTitle')}
              className={`text-xs h-8 px-3 font-bold transition-all rounded-lg ${
                hasUnsavedChanges
                  ? 'opacity-40 cursor-not-allowed bg-slate-100 text-slate-400 border-slate-200'
                  : sortKey === 'rankTitle'
                    ? 'bg-slate-900 text-white border-slate-900 shadow-2xs'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              <Award className="w-3.5 h-3.5 mr-1 text-amber-500" />
              称号・段位
              {sortKey === 'rankTitle' &&
                (sortDirection === 'asc' ? (
                  <ArrowUp className="w-3.5 h-3.5 ml-1" />
                ) : (
                  <ArrowDown className="w-3.5 h-3.5 ml-1" />
                ))}
            </Button>

            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={hasUnsavedChanges}
              onClick={() => handleToggleSort('staffRole')}
              className={`text-xs h-8 px-3 font-bold transition-all rounded-lg ${
                hasUnsavedChanges
                  ? 'opacity-40 cursor-not-allowed bg-slate-100 text-slate-400 border-slate-200'
                  : sortKey === 'staffRole'
                    ? 'bg-slate-900 text-white border-slate-900 shadow-2xs'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              役員役割
              {sortKey === 'staffRole' &&
                (sortDirection === 'asc' ? (
                  <ArrowUp className="w-3.5 h-3.5 ml-1" />
                ) : (
                  <ArrowDown className="w-3.5 h-3.5 ml-1" />
                ))}
            </Button>

            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={hasUnsavedChanges}
              onClick={() => handleToggleSort('staffDutyShift')}
              className={`text-xs h-8 px-3 font-bold transition-all rounded-lg ${
                hasUnsavedChanges
                  ? 'opacity-40 cursor-not-allowed bg-slate-100 text-slate-400 border-slate-200'
                  : sortKey === 'staffDutyShift'
                    ? 'bg-slate-900 text-white border-slate-900 shadow-2xs'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              シフト
              {sortKey === 'staffDutyShift' &&
                (sortDirection === 'asc' ? (
                  <ArrowUp className="w-3.5 h-3.5 ml-1" />
                ) : (
                  <ArrowDown className="w-3.5 h-3.5 ml-1" />
                ))}
            </Button>
          </div>
        </div>
      </div>

      <div className="w-full space-y-3">
        {filteredAndSortedParticipants.length === 0 ? (
          <div className="w-full p-16 text-center bg-white rounded-2xl border border-slate-200 text-slate-400 text-xs">
            検索条件に一致する選手は見つかりませんでした。
          </div>
        ) : (
          filteredAndSortedParticipants.map((p) => {
            const isSaving = savingId === p.id;
            const isDeleting = deletingId === p.id;
            const isDuplicate = duplicateBibNumbers.has(p.bibNumber);
            const isDirty = checkIsDirty(p);

            return (
              <div
                key={p.id}
                className={`w-full bg-white border rounded-2xl p-5 flex flex-col xl:flex-row xl:items-start justify-between gap-4 text-xs transition-shadow shadow-xs hover:shadow-sm ${
                  isDuplicate
                    ? 'border-red-400 bg-red-50/20'
                    : isDirty
                      ? 'border-amber-400/90 ring-1 ring-amber-300/60 bg-amber-50/10'
                      : 'border-slate-200/80'
                }`}
              >
                <div className="flex flex-col items-center justify-start shrink-0 pt-1 min-w-[130px] border-b xl:border-b-0 xl:border-r border-slate-100 pb-3 xl:pb-0 xl:pr-4">
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="text-[10px] font-mono text-slate-400 font-bold">
                      ゼッケンNo.
                    </span>
                    {isDirty && (
                      <span className="text-[9px] font-bold bg-amber-100 text-amber-800 border border-amber-300 px-1.5 py-0.2 rounded-full">
                        未保存
                      </span>
                    )}
                  </div>

                  <input
                    type="number"
                    min={1}
                    value={p.bibNumber}
                    onChange={(e) =>
                      handleChangeBibNumber(p.id, e.target.value)
                    }
                    className={`w-20 p-2 text-center font-mono font-black text-base rounded-xl border outline-none transition-colors ${
                      isDuplicate
                        ? 'bg-red-50 border-red-400 text-red-900 focus:ring-1 focus:ring-red-400'
                        : 'bg-slate-50 border-slate-300 text-slate-900 focus:bg-white focus:border-slate-900'
                    }`}
                    title="ゼッケン番号を変更"
                  />
                  {isDuplicate && (
                    <span className="text-[9px] font-bold text-red-600 mt-1 flex items-center gap-0.5">
                      <AlertTriangle className="w-2.5 h-2.5" /> 重複警告
                    </span>
                  )}

                  <div className="w-full mt-3 pt-2 border-t border-slate-100 text-center">
                    <span className="text-[9px] text-slate-400 font-bold block">
                      申込担当者
                    </span>
                    <span
                      className="text-[11px] font-bold text-slate-800 block truncate"
                      title={p.representativeName}
                    >
                      {p.representativeName || '未登録'} 様
                    </span>
                    <span
                      className="text-[10px] font-mono text-slate-500 flex items-center justify-center gap-1 mt-0.5"
                      title={p.representativeEmail}
                    >
                      <Mail className="w-3 h-3 text-slate-400 shrink-0" />
                      <span className="truncate max-w-50">
                        {p.representativeEmail || '未登録'}
                      </span>
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-4 gap-3 flex-1">
                  <div className="space-y-1">
                    <label className="text-[10px] text-slate-500 font-bold block">
                      選手氏名 <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={p.name}
                      onChange={(e) =>
                        handleChangeField(p.id, 'name', e.target.value)
                      }
                      placeholder="例: 明太花子"
                      className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-900 font-bold text-xs outline-none focus:bg-white focus:border-slate-900"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] text-slate-500 font-bold block">
                      ふりがな
                    </label>
                    <input
                      type="text"
                      value={p.nameKana}
                      onChange={(e) =>
                        handleChangeField(p.id, 'nameKana', e.target.value)
                      }
                      placeholder="例: めんたいはなこ"
                      className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-900 font-medium text-xs outline-none focus:bg-white focus:border-slate-900"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] text-slate-500 font-bold block">
                      所属道場・団体名
                    </label>
                    <input
                      type="text"
                      value={p.organization}
                      onChange={(e) =>
                        handleChangeField(p.id, 'organization', e.target.value)
                      }
                      placeholder="例: 福岡弓道倶楽部"
                      className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-900 font-medium text-xs outline-none focus:bg-white focus:border-slate-900"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] text-slate-500 font-bold block">
                      所作区分
                    </label>
                    <select
                      value={p.shosa}
                      onChange={(e) =>
                        handleChangeSelectField(
                          p.id,
                          'shosa',
                          e.target.value as ShosaType,
                        )
                      }
                      className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-900 font-bold text-xs outline-none focus:bg-white focus:border-slate-900"
                    >
                      <option value="肌脱ぎ">肌脱ぎ</option>
                      <option value="襷掛け">襷掛け</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] text-slate-500 font-bold block">
                      称号・段位
                    </label>
                    <select
                      value={p.rankTitle}
                      onChange={(e) =>
                        handleChangeSelectField(
                          p.id,
                          'rankTitle',
                          e.target.value as RankTitleType,
                        )
                      }
                      className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-900 font-bold text-xs outline-none focus:bg-white focus:border-slate-900"
                    >
                      <option value="段位は三段以下">段位は三段以下</option>
                      <option value="段位は四段以上">段位は四段以上</option>
                      <option value="称号を取得している">
                        称号を取得している
                      </option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] text-slate-500 font-bold block">
                      役員役割 / シフト
                    </label>
                    <div className="grid grid-cols-2 gap-1.5">
                      <select
                        value={p.staffRole}
                        onChange={(e) =>
                          handleChangeSelectField(
                            p.id,
                            'staffRole',
                            e.target.value as StaffRoleType,
                          )
                        }
                        className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-900 font-bold text-xs outline-none focus:bg-white focus:border-slate-900"
                      >
                        <option value="無し">役割: 無し</option>
                        <option value="進行">進行</option>
                        <option value="的前">的前</option>
                        <option value="招集">招集</option>
                        <option value="記録">記録</option>
                        <option value="カメラマン">カメラマン</option>
                        <option value="運営">運営</option>
                      </select>

                      <select
                        value={p.staffDutyShift}
                        onChange={(e) =>
                          handleChangeSelectField(
                            p.id,
                            'staffDutyShift',
                            e.target.value as StaffDutyShiftType,
                          )
                        }
                        className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-900 font-bold text-xs outline-none focus:bg-white focus:border-slate-900"
                      >
                        <option value="無し">シフト無し</option>
                        <option value="午前のみ">午前のみ</option>
                        <option value="午後のみ">午後のみ</option>
                        <option value="終日">終日</option>
                      </select>
                    </div>
                  </div>

                  <div className="md:col-span-2 space-y-1">
                    <label className="text-[10px] text-slate-500 font-bold block">
                      備考（連絡・配慮事項）
                    </label>
                    <input
                      type="text"
                      value={p.notes}
                      onChange={(e) =>
                        handleChangeField(p.id, 'notes', e.target.value)
                      }
                      placeholder="配慮事項や連絡メモなど"
                      className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-900 font-medium text-xs outline-none focus:bg-white focus:border-slate-900"
                    />
                  </div>

                  <div className="flex items-center pt-2">
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={p.needsSupport}
                        onChange={(e) =>
                          handleChangeSelectField(
                            p.id,
                            'needsSupport',
                            e.target.checked,
                          )
                        }
                        className="rounded text-slate-900 focus:ring-slate-900 w-4 h-4"
                      />
                      <span className="text-[11px] font-bold text-amber-900 flex items-center gap-1">
                        <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                        本座所作サポート希望
                      </span>
                    </label>
                  </div>
                </div>

                {/* 操作ボタングループ */}
                <div className="flex flex-row xl:flex-col items-center justify-end shrink-0 gap-2 pt-2 xl:pt-0 self-end xl:self-center">
                  <Button
                    type="button"
                    size="sm"
                    disabled={
                      !isDirty ||
                      isSaving ||
                      isDeleting ||
                      isDuplicate ||
                      !p.name.trim()
                    }
                    onClick={() => handleUpdateParticipant(p)}
                    className={`font-black text-xs h-9 px-4 transition-all rounded-xl ${
                      isDirty && !isDuplicate && p.name.trim()
                        ? 'bg-slate-900 hover:bg-slate-800 text-white shadow-xs active:scale-95'
                        : 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed opacity-60'
                    }`}
                    title={
                      !isDirty
                        ? '変更がありません'
                        : isDuplicate
                          ? 'ゼッケン番号が重複しているため保存できません'
                          : !p.name.trim()
                            ? '選手氏名を入力してください'
                            : '選手情報を保存'
                    }
                  >
                    {isSaving ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <>
                        <Save
                          className={`w-3.5 h-3.5 mr-1 ${
                            isDirty ? 'text-amber-400' : 'text-slate-400'
                          }`}
                        />
                        保存
                      </>
                    )}
                  </Button>

                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={isSaving || isDeleting}
                    onClick={() => setDeleteTarget(p)}
                    className="font-bold text-xs h-9 px-3 border-red-200 bg-red-50/40 text-red-700 hover:bg-red-100/80 hover:text-red-800 hover:border-red-300 transition-all rounded-xl"
                    title="この選手データを削除"
                  >
                    <Trash2 className="w-3.5 h-3.5 mr-1 text-red-600" />
                    削除
                  </Button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* 選手データ削除確認モーダル */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 p-6 space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex items-start justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2 text-red-600">
                <div className="p-2 bg-red-50 rounded-xl">
                  <AlertTriangle className="w-5 h-5 text-red-600" />
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-900">
                    選手登録の削除確認
                  </h3>
                  <span className="text-[11px] text-slate-500 font-medium">
                    この操作は取り消せません
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2 text-xs">
              <div className="flex justify-between items-center text-slate-700 pb-1.5 border-b border-slate-200">
                <span className="text-slate-500 font-bold">ゼッケン番号:</span>
                <span className="font-mono font-black text-sm text-slate-900">
                  No.{deleteTarget.bibNumber}
                </span>
              </div>
              <div className="flex justify-between items-center text-slate-700 pb-1.5 border-b border-slate-200">
                <span className="text-slate-500 font-bold">選手氏名:</span>
                <span className="font-black text-slate-900 text-sm">
                  {deleteTarget.name} 様
                </span>
              </div>
              <div className="flex justify-between items-center text-slate-700 pb-1.5 border-b border-slate-200">
                <span className="text-slate-500 font-bold">所属団体:</span>
                <span className="font-bold text-slate-800">
                  {deleteTarget.organization || '無所属'}
                </span>
              </div>
              <div className="flex justify-between items-center text-slate-700">
                <span className="text-slate-500 font-bold">申込担当者:</span>
                <span className="font-medium text-slate-800">
                  {deleteTarget.representativeName || '未登録'} 様
                </span>
              </div>
            </div>

            <p className="text-xs text-red-600 leading-relaxed font-medium">
              ※削除すると、該当選手のスコア記録や立ち順割り当て情報も完全に消失します。本当に削除してよろしいですか？
            </p>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={deletingId !== null}
                onClick={() => setDeleteTarget(null)}
                className="text-xs border-slate-300 text-slate-700 h-9 px-4 rounded-xl"
              >
                キャンセル
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={deletingId !== null}
                onClick={handleConfirmDelete}
                className="bg-red-600 hover:bg-red-700 text-white font-bold text-xs h-9 px-4 rounded-xl shadow-xs transition-transform active:scale-95"
              >
                {deletingId !== null ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
                    削除実行中...
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5 mr-1" />
                    削除を実行する
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
