/**
 * 【エントリー照会・入金承認・立順編成・QRコード配信専用コンソール】
 * /admin/check パスに対応するページコンポーネント。
 *
 * 役割:
 * 1. エントリー詳細の照会（ゼッケン番号、選手氏名、所属、所作、段位、サポート希望、担当者情報）。
 * 2. 参加費納付（isPaid）の承認・取り消しと Firestore への即時反映（楽観的UI更新）。
 * 3. 午前（第1立）および午後（第2・3立）の立ち順インライン編集。
 * 4. 【立順設定・保存・送信の段階的連動（フールプルーフ）】:
 *    - 午前・午後の組および射位がすべて選択された時点で「保存」ボタンがアクティブ化。
 *    - 保存ボタンが押下され、Firestore への書き込みが完了した後に「メール送信」ボタンがアクティブ化。
 *    - 編集後に保存されていない状態（未保存/Dirty）ではメール送信を遮断し、誤った立順での誤送信を未然に防止。
 * 5. 立順重複（同一組・同一射位の衝突）およびゼッケン重複のリアルタイム検知・保存ブロック。
 * 6. メール送信ボタンによる一体型QRカード添付メールの配信（個別送信・一括送信）。
 * 7. サマリー統計カード（総エントリー、入金済、立順未割当、QR未送信）のリアルタイム集計表示。
 *
 * フールプルーフ設計（事故前・対人間）:
 * - 午前午後の立順が揃っていない段階では保存ボタンを非活性化（理由をツールチップ・バッジで明示）。
 * - 変更後に未保存のままメール送信ボタンを押す操作を非活性化により入口で遮断。
 * - 重複した立ち順の選手は保存をブロックし、該当セルを赤色警告表示。
 *
 * フェイルセーフ設計（事故後・対故障）:
 * - Firestore 書き込み失敗時は直前の確定状態へ安全にロールバック。
 * - メールAPIリクエストに 15秒 のタイムアウト（AbortController）を設定し、UI膠着を回避。
 */

'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
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
  StandRoundIndex,
  StandOrderIndex,
  QrDeliveryStatus,
  sanitizeStandOrder,
  sanitizeStandGroup,
  StandAssignment,
} from '@/types';
import { generateQrCardImage } from '@/lib/qrCardGenerator';
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
  CreditCard,
  QrCode,
  Send,
  RefreshCw,
  Clock,
  AlertTriangle,
  Mail,
  Sun,
  Moon,
  Save,
  Filter,
  Check,
} from 'lucide-react';

const API_TIMEOUT_MS = 15000;

function getNowTimestamp(): number {
  return Date.now();
}

/**
 * 立ち順の比較用ハッシュキーを生成するヘルパー関数
 */
function createAssignmentKey(
  assignments: Record<StandRoundIndex, StandAssignment>,
): string {
  const m = assignments[1];
  const a = assignments[2];
  const mG = m?.standGroup ?? '';
  const mO = m?.standOrder ?? '';
  const aG = a?.standGroup ?? '';
  const aO = a?.standOrder ?? '';
  return `${mG}:${mO}:${aG}:${aO}`;
}

export default function AdminCheckManagementPage() {
  const router = useRouter();
  const isDbReady = isFirebaseConfigured && isFirestoreAvailable(db);

  // 画面編集用参加者リスト
  const [participants, setParticipants] = useState<Participant[]>([]);
  // Firestoreに確定保存されている立順ハッシュマップ (participantId -> string)
  const [savedAssignmentsMap, setSavedAssignmentsMap] = useState<
    Record<string, string>
  >({});

  const [isLoading, setIsLoading] = useState<boolean>(() => isDbReady);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [processingQrId, setProcessingQrId] = useState<string | null>(null);
  const [isBatchSending, setIsBatchSending] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>(() =>
    !isDbReady ? 'Firebaseデータベースに接続されていません。' : '',
  );

  // 検索・フィルターステート
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [filterPaid, setFilterPaid] = useState<'ALL' | 'PAID' | 'UNPaid'>(
    'ALL',
  );
  const [filterQr, setFilterQr] = useState<'ALL' | 'SENT' | 'UNSENT'>('ALL');
  const [filterStand, setFilterStand] = useState<
    'ALL' | 'ASSIGNED' | 'UNASSIGNED'
  >('ALL');

  // 1. Firestore entries コレクションのリアルタイム購読
  useEffect(() => {
    if (!isFirebaseConfigured || !isFirestoreAvailable(db)) {
      return;
    }

    const q = query(collection(db, 'entries'), orderBy('bibNumber', 'asc'));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const loaded: Participant[] = [];
        const savedMap: Record<string, string> = {};

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

          const participantItem: Participant = {
            id: docSnap.id,
            bibNumber:
              typeof raw.bibNumber === 'number'
                ? raw.bibNumber
                : Number(raw.bibNumber) || 1,
            name: typeof raw.name === 'string' ? raw.name : '選手名未設定',
            nameKana: typeof raw.nameKana === 'string' ? raw.nameKana : '',
            organization:
              typeof raw.organization === 'string' ? raw.organization : '',
            shosa: raw.shosa || '肌脱ぎ',
            rankTitle: raw.rankTitle || '段位は三段以下',
            staffRole: raw.staffRole || '無し',
            staffDutyShift: raw.staffDutyShift || '無し',
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
            agreedAt:
              typeof raw.agreedAt === 'number' ? raw.agreedAt : undefined,
            updatedAt:
              typeof raw.updatedAt === 'number' ? raw.updatedAt : undefined,
            userId: typeof raw.userId === 'string' ? raw.userId : undefined,
          };

          loaded.push(participantItem);
          savedMap[docSnap.id] = createAssignmentKey(safeAssignments);
        });

        setParticipants(loaded);
        setSavedAssignmentsMap(savedMap);
        setIsLoading(false);
      },
      (err) => {
        console.error('【Firestore購読エラー】:', err);
        setErrorMessage('参加者データの読み込みに失敗しました。');
        setIsLoading(false);
      },
    );

    return () => unsubscribe();
  }, []);

  // ゼッケン重複チェック
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

  // 立順重複チェック（午前・午後）
  const {
    duplicateMorningPlayerIds,
    duplicateAfternoonPlayerIds,
    duplicateMorningSlotLabels,
    duplicateAfternoonSlotLabels,
  } = useMemo(() => {
    const mCounts = new Map<string, string[]>();
    const aCounts = new Map<string, string[]>();

    participants.forEach((p) => {
      const mAssign = p.standAssignments[1];
      if (
        mAssign &&
        mAssign.standGroup !== null &&
        mAssign.standOrder !== null
      ) {
        const mKey = `${mAssign.standGroup}_${mAssign.standOrder}`;
        const mList = mCounts.get(mKey) || [];
        mList.push(p.id);
        mCounts.set(mKey, mList);
      }

      const aAssign = p.standAssignments[2];
      if (
        aAssign &&
        aAssign.standGroup !== null &&
        aAssign.standOrder !== null
      ) {
        const aKey = `${aAssign.standGroup}_${aAssign.standOrder}`;
        const aList = aCounts.get(aKey) || [];
        aList.push(p.id);
        aCounts.set(aKey, aList);
      }
    });

    const mDupIds = new Set<string>();
    const mLabels: string[] = [];
    mCounts.forEach((ids, key) => {
      if (ids.length > 1) {
        ids.forEach((id) => mDupIds.add(id));
        const [g, o] = key.split('_');
        mLabels.push(`第${g}組-${o}番 (${ids.length}名)`);
      }
    });

    const aDupIds = new Set<string>();
    const aLabels: string[] = [];
    aCounts.forEach((ids, key) => {
      if (ids.length > 1) {
        ids.forEach((id) => aDupIds.add(id));
        const [g, o] = key.split('_');
        aLabels.push(`第${g}組-${o}番 (${ids.length}名)`);
      }
    });

    return {
      duplicateMorningPlayerIds: mDupIds,
      duplicateAfternoonPlayerIds: aDupIds,
      duplicateMorningSlotLabels: mLabels,
      duplicateAfternoonSlotLabels: aLabels,
    };
  }, [participants]);

  // サマリー集計
  const stats = useMemo(() => {
    const total = participants.length;
    const paidCount = participants.filter((p) => p.isPaid).length;
    const qrSentCount = participants.filter(
      (p) => p.qrSentStatus === 'SENT',
    ).length;
    const unassignedCount = participants.filter((p) => {
      const m = p.standAssignments[1];
      const a = p.standAssignments[2];
      return (
        !m ||
        m.standGroup === null ||
        m.standOrder === null ||
        !a ||
        a.standGroup === null ||
        a.standOrder === null
      );
    }).length;
    return { total, paidCount, qrSentCount, unassignedCount };
  }, [participants]);

  // フィルタリング処理
  const filteredParticipants = useMemo(() => {
    return participants.filter((p) => {
      const matchesSearch =
        searchTerm.trim() === '' ||
        p.name.includes(searchTerm) ||
        p.nameKana.includes(searchTerm) ||
        p.organization.includes(searchTerm) ||
        p.representativeName.includes(searchTerm) ||
        p.representativeEmail.includes(searchTerm) ||
        p.bibNumber.toString().includes(searchTerm);

      const matchesPaid =
        filterPaid === 'ALL' ||
        (filterPaid === 'PAID' && p.isPaid) ||
        (filterPaid === 'UNPaid' && !p.isPaid);

      const matchesQr =
        filterQr === 'ALL' ||
        (filterQr === 'SENT' && p.qrSentStatus === 'SENT') ||
        (filterQr === 'UNSENT' && p.qrSentStatus !== 'SENT');

      const m = p.standAssignments[1];
      const a = p.standAssignments[2];
      const isFullyAssigned =
        m &&
        m.standGroup !== null &&
        m.standOrder !== null &&
        a &&
        a.standGroup !== null &&
        a.standOrder !== null;

      const matchesStand =
        filterStand === 'ALL' ||
        (filterStand === 'ASSIGNED' && isFullyAssigned) ||
        (filterStand === 'UNASSIGNED' && !isFullyAssigned);

      return matchesSearch && matchesPaid && matchesQr && matchesStand;
    });
  }, [participants, searchTerm, filterPaid, filterQr, filterStand]);

  // 一括送信対象の判定（入金済、立順完全設定済、保存完了済み、未送信）
  const pendingQrParticipants = useMemo(() => {
    return participants.filter((p) => {
      const m = p.standAssignments[1];
      const a = p.standAssignments[2];
      const isFullyAssigned =
        m &&
        m.standGroup !== null &&
        m.standOrder !== null &&
        a &&
        a.standGroup !== null &&
        a.standOrder !== null;

      const currentKey = createAssignmentKey(p.standAssignments);
      const savedKey = savedAssignmentsMap[p.id] || '';
      const isSaved = currentKey === savedKey;

      return (
        p.isPaid && isFullyAssigned && isSaved && p.qrSentStatus !== 'SENT'
      );
    });
  }, [participants, savedAssignmentsMap]);

  // 入金承認トグル
  const handleTogglePayment = async (participant: Participant) => {
    if (!isFirebaseConfigured || !isFirestoreAvailable(db)) return;

    const previousPaidStatus = participant.isPaid;
    const newPaidStatus = !previousPaidStatus;

    setParticipants((prev) =>
      prev.map((p) =>
        p.id === participant.id
          ? {
              ...p,
              isPaid: newPaidStatus,
              paidAt: newPaidStatus ? getNowTimestamp() : null,
            }
          : p,
      ),
    );

    setSavingId(participant.id);
    setErrorMessage('');

    try {
      const docRef = doc(db, 'entries', participant.id);
      await updateDoc(docRef, {
        isPaid: newPaidStatus,
        paidAt: newPaidStatus ? getNowTimestamp() : null,
        updatedAt: serverTimestamp(),
      });

      setStatusMessage(
        `ゼッケンNo.${participant.bibNumber} ${participant.name} 選手の入金を「${
          newPaidStatus ? '承認済' : '未納'
        }」に更新しました。`,
      );
      setTimeout(() => setStatusMessage(''), 2500);
    } catch (err) {
      console.error('【入金更新エラー】:', err);
      // ロールバック
      setParticipants((prev) =>
        prev.map((p) =>
          p.id === participant.id
            ? { ...p, isPaid: previousPaidStatus, paidAt: participant.paidAt }
            : p,
        ),
      );
      setErrorMessage(
        '入金状態の更新に失敗しました。通信環境を確認してください。',
      );
    } finally {
      setSavingId(null);
    }
  };

  // 立順変更入力ハンドラー
  const handleAssignmentChange = (
    id: string,
    period: 'morning' | 'afternoon',
    field: 'standGroup' | 'standOrder',
    val: number | null,
  ) => {
    setParticipants((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p;

        if (period === 'morning') {
          const cur = p.standAssignments[1] || {
            standGroup: null,
            standOrder: null,
          };
          return {
            ...p,
            standAssignments: {
              ...p.standAssignments,
              1: { ...cur, [field]: val },
            },
          };
        } else {
          const cur = p.standAssignments[2] || {
            standGroup: null,
            standOrder: null,
          };
          const updated = { ...cur, [field]: val };
          return {
            ...p,
            standAssignments: {
              ...p.standAssignments,
              2: updated,
              3: updated,
            },
          };
        }
      }),
    );
  };

  // 【立順保存処理】午前午後の設定完了かつ変更がある場合に実行可能
  const handleSaveParticipantSettings = async (participant: Participant) => {
    if (!isFirebaseConfigured || !isFirestoreAvailable(db)) return;

    if (duplicateBibNumbers.has(participant.bibNumber)) {
      setErrorMessage(
        `ゼッケンNo.${participant.bibNumber} が重複しているため保存できません。`,
      );
      return;
    }

    const isMorningDup = duplicateMorningPlayerIds.has(participant.id);
    const isAfternoonDup = duplicateAfternoonPlayerIds.has(participant.id);
    if (isMorningDup || isAfternoonDup) {
      const periodText =
        isMorningDup && isAfternoonDup
          ? '午前および午後'
          : isMorningDup
            ? '午前'
            : '午後';
      setErrorMessage(
        `ゼッケンNo.${participant.bibNumber} ${participant.name} 選手の${periodText}の立順が他の選手と重複しています。修正してください。`,
      );
      return;
    }

    setSavingId(participant.id);
    setErrorMessage('');

    try {
      const morningData = participant.standAssignments[1] || {
        standGroup: null,
        standOrder: null,
      };
      const afternoonData = participant.standAssignments[2] || {
        standGroup: null,
        standOrder: null,
      };

      const normalizedAssignments: Record<
        StandRoundIndex,
        { standGroup: number | null; standOrder: StandOrderIndex | null }
      > = {
        1: morningData,
        2: afternoonData,
        3: afternoonData,
      };

      const docRef = doc(db, 'entries', participant.id);
      await updateDoc(docRef, {
        bibNumber: participant.bibNumber,
        standAssignments: normalizedAssignments,
        updatedAt: serverTimestamp(),
      });

      // 保存済みハッシュを更新してメール送信ボタンをアクティブ化
      const newKey = createAssignmentKey(normalizedAssignments);
      setSavedAssignmentsMap((prev) => ({
        ...prev,
        [participant.id]: newKey,
      }));

      setStatusMessage(
        `ゼッケンNo.${participant.bibNumber} ${participant.name} 選手の立順設定を保存しました。メール送信が可能になりました。`,
      );
      setTimeout(() => setStatusMessage(''), 3000);
    } catch (err) {
      console.error('【保存エラー】:', err);
      setErrorMessage('立順設定の保存に失敗しました。');
    } finally {
      setSavingId(null);
    }
  };

  // 【個別QRコード送信処理】保存完了後のみ実行可能
  const handleSendSingleQr = async (participant: Participant) => {
    if (!isFirebaseConfigured || !isFirestoreAvailable(db)) return;

    if (!participant.isPaid) {
      setErrorMessage(
        `【No.${participant.bibNumber} ${participant.name} 選手】参加費が未納です。入金を承認してください。`,
      );
      return;
    }

    const m = participant.standAssignments[1];
    const a = participant.standAssignments[2];
    const isMorningMissing =
      !m || m.standGroup === null || m.standOrder === null;
    const isAfternoonMissing =
      !a || a.standGroup === null || a.standOrder === null;

    if (isMorningMissing || isAfternoonMissing) {
      setErrorMessage(
        `【No.${participant.bibNumber} ${participant.name} 選手】立ち順が未設定です。設定後に「保存」を行ってください。`,
      );
      return;
    }

    // 未保存変更のガード（フールプルーフ）
    const currentKey = createAssignmentKey(participant.standAssignments);
    const savedKey = savedAssignmentsMap[participant.id] || '';
    if (currentKey !== savedKey) {
      setErrorMessage(
        `【No.${participant.bibNumber} ${participant.name} 選手】立順の変更が保存されていません。先に「保存」ボタンを押してください。`,
      );
      return;
    }

    const targetEmail = participant.representativeEmail.trim();
    if (!targetEmail || !targetEmail.includes('@')) {
      setErrorMessage(
        `有効なメールアドレスが登録されていません: ${targetEmail}`,
      );
      return;
    }

    setProcessingQrId(participant.id);
    setErrorMessage('');
    setStatusMessage('');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

    try {
      const qrPayload = JSON.stringify({
        id: participant.id,
        bib: participant.bibNumber,
        name: participant.name,
        org: participant.organization,
        s1g: m.standGroup,
        s1o: m.standOrder,
        s2g: a.standGroup,
        s2o: a.standOrder,
      });

      const cardResult = await generateQrCardImage(participant, {
        tournamentTitle: '第5回めんたいこ杯争奪弓道大会',
        checkinPayload: qrPayload,
      });

      const response = await fetch(
        'http://127.0.0.1:8000/api/v1/email/send-qr-single',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            tournamentTitle: '第5回めんたいこ杯争奪弓道大会',
            participantId: participant.id,
            bibNumber: participant.bibNumber,
            name: participant.name,
            nameKana: participant.nameKana || '',
            email: targetEmail,
            organization: participant.organization || '無所属',
            shosa: participant.shosa || '肌脱ぎ',
            rankTitle: participant.rankTitle || '段位は三段以下',
            stand1Group: m.standGroup,
            stand1Order: m.standOrder,
            stand2Group: a.standGroup,
            stand2Order: a.standOrder,
            checkinPayload: qrPayload,
            qrCardBase64: cardResult.dataUrl,
          }),
        },
      );

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`API通信エラー (HTTP ${response.status})`);
      }

      const result = await response.json();
      if (!result.success) {
        throw new Error(
          result.errorDetail || result.message || 'メール送信失敗',
        );
      }

      const docRef = doc(db, 'entries', participant.id);
      await updateDoc(docRef, {
        qrSentStatus: 'SENT' as QrDeliveryStatus,
        qrSentAt: getNowTimestamp(),
        qrSentError: null,
        updatedAt: serverTimestamp(),
      });

      setStatusMessage(
        `ゼッケンNo.${participant.bibNumber} ${participant.name} 選手に一体型QRカード付き案内メールを送信しました。`,
      );
      setTimeout(() => setStatusMessage(''), 2500);
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      console.error('【QR送信エラー】:', err);
      const detail = err instanceof Error ? err.message : '通信エラー';

      try {
        const docRef = doc(db, 'entries', participant.id);
        await updateDoc(docRef, {
          qrSentStatus: 'FAILED' as QrDeliveryStatus,
          qrSentError: detail,
          updatedAt: serverTimestamp(),
        });
      } catch (dbErr) {
        console.error('【ステータス更新失敗】:', dbErr);
      }

      setErrorMessage(
        `QRメール送信に失敗しました（No.${participant.bibNumber}）: ${detail}`,
      );
    } finally {
      setProcessingQrId(null);
    }
  };

  // 【一括QRコード送信処理】
  const handleBatchSendQr = async () => {
    if (pendingQrParticipants.length === 0) return;

    const confirmed = window.confirm(
      `入金承認済みかつ立順が確定・保存済みの選手 ${pendingQrParticipants.length} 名に一体型QRカード付き案内メールを一括送信しますか？`,
    );
    if (!confirmed) return;

    setIsBatchSending(true);
    setErrorMessage('');
    setStatusMessage('');

    let successCount = 0;
    let failCount = 0;

    for (const participant of pendingQrParticipants) {
      const m = participant.standAssignments[1];
      const a = participant.standAssignments[2];
      if (
        !m ||
        m.standGroup === null ||
        m.standOrder === null ||
        !a ||
        a.standGroup === null ||
        a.standOrder === null
      ) {
        failCount += 1;
        continue;
      }

      const targetEmail = participant.representativeEmail.trim();
      if (!targetEmail || !targetEmail.includes('@')) {
        failCount += 1;
        continue;
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

      try {
        const qrPayload = JSON.stringify({
          id: participant.id,
          bib: participant.bibNumber,
          name: participant.name,
          org: participant.organization,
          s1g: m.standGroup,
          s1o: m.standOrder,
          s2g: a.standGroup,
          s2o: a.standOrder,
        });

        const cardResult = await generateQrCardImage(participant, {
          tournamentTitle: '第5回めんたいこ杯争奪弓道大会',
          checkinPayload: qrPayload,
        });

        const res = await fetch(
          'http://127.0.0.1:8000/api/v1/email/send-qr-single',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
              tournamentTitle: '第5回めんたいこ杯争奪弓道大会',
              participantId: participant.id,
              bibNumber: participant.bibNumber,
              name: participant.name,
              nameKana: participant.nameKana || '',
              email: targetEmail,
              organization: participant.organization || '無所属',
              shosa: participant.shosa || '肌脱ぎ',
              rankTitle: participant.rankTitle || '段位は三段以下',
              stand1Group: m.standGroup,
              stand1Order: m.standOrder,
              stand2Group: a.standGroup,
              stand2Order: a.standOrder,
              checkinPayload: qrPayload,
              qrCardBase64: cardResult.dataUrl,
            }),
          },
        );

        clearTimeout(timeoutId);

        if (res.ok) {
          const json = await res.json();
          if (json.success) {
            const docRef = doc(db, 'entries', participant.id);
            await updateDoc(docRef, {
              qrSentStatus: 'SENT' as QrDeliveryStatus,
              qrSentAt: getNowTimestamp(),
              qrSentError: null,
              updatedAt: serverTimestamp(),
            });
            successCount += 1;
          } else {
            failCount += 1;
          }
        } else {
          failCount += 1;
        }
      } catch (err: unknown) {
        clearTimeout(timeoutId);
        console.error(
          `【一括QR送信個別例外 No.${participant.bibNumber}】:`,
          err,
        );
        failCount += 1;
      }
    }

    setIsBatchSending(false);
    setStatusMessage(
      `一括送信完了: 成功 ${successCount} 名 / 失敗 ${failCount} 名`,
    );
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex flex-col items-center justify-center p-8 text-slate-500 w-full">
        <Loader2 className="w-8 h-8 animate-spin mb-2 text-slate-900" />
        <span className="text-xs font-mono font-bold">
          エントリー確認コンソールをロード中...
        </span>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-[#F8FAFC] text-slate-900 p-4 sm:p-6 lg:p-8 space-y-6 w-full">
      {/* ページヘッダー */}
      <div className="w-full flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white border border-slate-200/80 p-6 rounded-2xl shadow-sm">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold bg-slate-900 text-white px-3 py-1 rounded-full flex items-center gap-1 shadow-2xs">
              <QrCode className="w-3.5 h-3.5 text-amber-400" />{' '}
              エントリー・QR管理
            </span>
            <span className="text-xs font-semibold text-slate-600 bg-slate-100 px-2.5 py-0.5 rounded-md">
              /admin/check
            </span>
          </div>
          <h1 className="text-xl md:text-2xl font-black text-slate-900 pt-1">
            入金確認・立順編成・正式QRコード発行
          </h1>
          <p className="text-xs text-slate-500 font-medium">
            午前・午後の立ち順を選択すると「保存」が有効化され、保存完了後に「メール送信」がアクティブになります。
          </p>
        </div>

        <div className="flex items-center gap-2 self-start md:self-auto">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push('/admin')}
            className="text-xs bg-white border-slate-200 text-slate-700 hover:bg-slate-50 font-bold h-9"
          >
            <ArrowLeft className="w-3.5 h-3.5 mr-1" />
            本部ダッシュボード
          </Button>

          <Button
            type="button"
            size="sm"
            disabled={isBatchSending || pendingQrParticipants.length === 0}
            onClick={handleBatchSendQr}
            className="bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs h-9 px-4 rounded-xl shadow-xs disabled:opacity-40"
          >
            {isBatchSending ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                一括送信中...
              </>
            ) : (
              <>
                <Send className="w-3.5 h-3.5 mr-1.5 text-amber-400" />
                入金＆保存済みに一括QR送信 ({pendingQrParticipants.length}名)
              </>
            )}
          </Button>
        </div>
      </div>

      {/* サマリーステータスカード群 */}
      <div className="w-full grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-2xs space-y-1">
          <span className="text-xs font-bold text-slate-500 flex items-center gap-1.5">
            <Users className="w-4 h-4 text-slate-600" /> 総エントリー数
          </span>
          <div className="text-2xl font-black text-slate-900 font-mono">
            {stats.total}{' '}
            <span className="text-xs font-normal text-slate-400">名</span>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-2xs space-y-1">
          <span className="text-xs font-bold text-emerald-700 flex items-center gap-1.5">
            <CreditCard className="w-4 h-4 text-emerald-600" /> 入金承認済み
          </span>
          <div className="text-2xl font-black text-emerald-700 font-mono">
            {stats.paidCount}{' '}
            <span className="text-xs font-normal text-slate-400">
              / {stats.total}
            </span>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-2xs space-y-1">
          <span className="text-xs font-bold text-blue-700 flex items-center gap-1.5">
            <QrCode className="w-4 h-4 text-blue-600" /> QRコード送信完了
          </span>
          <div className="text-2xl font-black text-blue-700 font-mono">
            {stats.qrSentCount}{' '}
            <span className="text-xs font-normal text-slate-400">
              / {stats.total}
            </span>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-2xs space-y-1">
          <span className="text-xs font-bold text-amber-700 flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4 text-amber-600" /> 立順未割当
          </span>
          <div className="text-2xl font-black text-amber-700 font-mono">
            {stats.unassignedCount}{' '}
            <span className="text-xs font-normal text-slate-400">名</span>
          </div>
        </div>
      </div>

      {/* ステータスメッセージバナー */}
      {statusMessage && (
        <div className="w-full p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs font-bold flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{statusMessage}</span>
        </div>
      )}

      {errorMessage && (
        <div className="w-full p-3.5 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs font-bold flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* ゼッケン番号重複警告 */}
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

      {/* 立順重複警告 */}
      {(duplicateMorningSlotLabels.length > 0 ||
        duplicateAfternoonSlotLabels.length > 0) && (
        <div className="w-full p-4 bg-red-50 border border-red-200 rounded-xl text-red-900 text-xs flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-bold text-red-800">
              立ち順（組番号・立順/射位）の重複を検知しました
            </p>
            {duplicateMorningSlotLabels.length > 0 && (
              <p className="text-[11px] text-red-700">
                ・午前の部 重複枠:{' '}
                <strong>{duplicateMorningSlotLabels.join(', ')}</strong>
              </p>
            )}
            {duplicateAfternoonSlotLabels.length > 0 && (
              <p className="text-[11px] text-red-700">
                ・午後の部 重複枠:{' '}
                <strong>{duplicateAfternoonSlotLabels.join(', ')}</strong>
              </p>
            )}
            <p className="text-[10px] text-red-600 pt-0.5">
              同一の組番号・射位に複数の選手を割り当てることはできません。修正するまで保存はブロックされます。
            </p>
          </div>
        </div>
      )}

      {/* 検索・フィルターツールバー */}
      <div className="w-full flex flex-col md:flex-row md:items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs">
        <div className="relative flex-1 max-w-lg">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="選手名・ふりがな・ゼッケン・所属・担当者名・メールで検索..."
            className="w-full pl-9 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 placeholder:text-slate-400 outline-none focus:bg-white focus:border-slate-900 font-medium transition-colors"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
            <CreditCard className="w-3.5 h-3.5 text-slate-500" />
            <select
              value={filterPaid}
              onChange={(e) =>
                setFilterPaid(e.target.value as 'ALL' | 'PAID' | 'UNPaid')
              }
              className="bg-transparent text-slate-700 font-bold outline-none cursor-pointer"
            >
              <option value="ALL">入金: すべて</option>
              <option value="PAID">入金承認済のみ</option>
              <option value="UNPaid">未納のみ</option>
            </select>
          </div>

          <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
            <Mail className="w-3.5 h-3.5 text-slate-500" />
            <select
              value={filterQr}
              onChange={(e) =>
                setFilterQr(e.target.value as 'ALL' | 'SENT' | 'UNSENT')
              }
              className="bg-transparent text-slate-700 font-bold outline-none cursor-pointer"
            >
              <option value="ALL">QR: すべて</option>
              <option value="SENT">QR送信済</option>
              <option value="UNSENT">QR未送信</option>
            </select>
          </div>

          <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
            <Filter className="w-3.5 h-3.5 text-slate-500" />
            <select
              value={filterStand}
              onChange={(e) =>
                setFilterStand(
                  e.target.value as 'ALL' | 'ASSIGNED' | 'UNASSIGNED',
                )
              }
              className="bg-transparent text-slate-700 font-bold outline-none cursor-pointer"
            >
              <option value="ALL">立順: すべて</option>
              <option value="ASSIGNED">割当完了</option>
              <option value="UNASSIGNED">未割当あり</option>
            </select>
          </div>
        </div>
      </div>

      {/* エントリー照会・設定テーブル */}
      <div className="w-full bg-white border border-slate-200/80 rounded-2xl overflow-hidden shadow-sm">
        <Table className="w-full text-xs">
          <TableHeader className="bg-slate-50/90 text-slate-700 border-b border-slate-200">
            <TableRow>
              <TableHead className="w-20 font-bold text-slate-900">
                ゼッケン
              </TableHead>
              <TableHead className="font-bold text-slate-900">
                選手情報 / 所作・段位
              </TableHead>
              <TableHead className="font-bold text-slate-900">
                申込担当者 (氏名 / メール)
              </TableHead>
              <TableHead className="font-bold text-slate-900 text-center w-36">
                参加費納付承認
              </TableHead>
              <TableHead className="font-bold text-slate-900">
                立順設定 (午前 / 午後連動)
              </TableHead>
              <TableHead className="font-bold text-slate-900 text-center w-28">
                立順保存
              </TableHead>
              <TableHead className="font-bold text-slate-900 text-center w-40">
                メール送信
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="divide-y divide-slate-100">
            {filteredParticipants.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="py-16 text-center text-slate-400 font-medium"
                >
                  該当するエントリー選手は見つかりませんでした。
                </TableCell>
              </TableRow>
            ) : (
              filteredParticipants.map((p) => {
                const isSaving = savingId === p.id;
                const isSendingQr = processingQrId === p.id;
                const isQrSent = p.qrSentStatus === 'SENT';
                const isQrFailed = p.qrSentStatus === 'FAILED';
                const isBibDuplicate = duplicateBibNumbers.has(p.bibNumber);

                const isMorningDuplicate = duplicateMorningPlayerIds.has(p.id);
                const isAfternoonDuplicate = duplicateAfternoonPlayerIds.has(
                  p.id,
                );
                const isAssignmentDuplicate =
                  isMorningDuplicate || isAfternoonDuplicate;

                const morningAssign = p.standAssignments[1] || {
                  standGroup: null,
                  standOrder: null,
                };
                const afternoonAssign = p.standAssignments[2] || {
                  standGroup: null,
                  standOrder: null,
                };

                // 1. 午前・午後の両方の組・射位がすべて選択されているか判定
                const isMorningComplete =
                  morningAssign.standGroup !== null &&
                  morningAssign.standOrder !== null;
                const isAfternoonComplete =
                  afternoonAssign.standGroup !== null &&
                  afternoonAssign.standOrder !== null;
                const isFullySelected =
                  isMorningComplete && isAfternoonComplete;

                // 2. 現在の入力値と、Firestore上の保存確定値を比較（未保存差分があるか判定）
                const currentKey = createAssignmentKey(p.standAssignments);
                const savedKey = savedAssignmentsMap[p.id] || '';
                const isDirty = currentKey !== savedKey;
                const isSavedInDb = isFullySelected && !isDirty;

                // 3. 【保存ボタンのアクティブ判定】
                const canSave =
                  isFullySelected &&
                  isDirty &&
                  !isBibDuplicate &&
                  !isAssignmentDuplicate;

                // 4. 【メール送信ボタンのアクティブ判定】
                const canSendEmail =
                  p.isPaid &&
                  isSavedInDb &&
                  !isBibDuplicate &&
                  !isAssignmentDuplicate;

                return (
                  <TableRow
                    key={p.id}
                    className={`hover:bg-slate-50/70 transition-colors ${
                      isBibDuplicate || isAssignmentDuplicate
                        ? 'bg-red-50/20'
                        : ''
                    }`}
                  >
                    {/* ゼッケン番号 */}
                    <TableCell className="font-mono font-black text-sm text-slate-900 align-top pt-4">
                      No.{p.bibNumber}
                      {isBibDuplicate && (
                        <span className="text-[9px] font-bold text-red-600 block mt-0.5">
                          重複
                        </span>
                      )}
                    </TableCell>

                    {/* 選手情報 */}
                    <TableCell className="align-top pt-4">
                      <div className="font-bold text-slate-900 text-sm">
                        {p.name}
                      </div>
                      <div className="text-[10px] text-slate-400">
                        {p.nameKana || 'かな未登録'}
                      </div>
                      <div className="text-[11px] text-slate-600 font-medium mt-1">
                        {p.organization || '無所属'}
                      </div>
                      <div className="text-[10px] text-slate-500 mt-0.5">
                        {p.shosa} ・ {p.rankTitle}
                      </div>
                      {p.needsSupport && (
                        <span className="inline-block mt-1 text-[9px] bg-amber-50 text-amber-800 border border-amber-200 px-1.5 py-0.2 rounded font-bold">
                          所作サポート希望
                        </span>
                      )}
                    </TableCell>

                    {/* 申込担当者情報 */}
                    <TableCell className="align-top pt-4 max-w-[200px]">
                      <div className="font-bold text-slate-800 text-xs">
                        {p.representativeName || '未登録'} 様
                      </div>
                      <div className="text-[11px] text-slate-500 font-mono flex items-center gap-1 mt-1">
                        <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span
                          className="truncate"
                          title={p.representativeEmail}
                        >
                          {p.representativeEmail || '未登録'}
                        </span>
                      </div>
                    </TableCell>

                    {/* 入金承認 */}
                    <TableCell className="text-center align-top pt-4">
                      <button
                        type="button"
                        disabled={isSaving}
                        onClick={() => handleTogglePayment(p)}
                        className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[11px] font-bold transition-all shadow-2xs active:scale-95 disabled:opacity-40 border ${
                          p.isPaid
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-300 hover:bg-emerald-100'
                            : 'bg-amber-50 text-amber-900 border-amber-300 hover:bg-amber-100'
                        }`}
                        title="クリックして入金承認状態を切り替え"
                      >
                        {p.isPaid ? (
                          <>
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                            承認済 (1,500円)
                          </>
                        ) : (
                          <>
                            <CreditCard className="w-3.5 h-3.5 text-amber-600" />
                            未納 (承認する)
                          </>
                        )}
                      </button>
                      {p.isPaid && p.paidAt && (
                        <div className="text-[9px] text-slate-400 mt-1 font-mono">
                          {new Date(p.paidAt).toLocaleDateString('ja-JP')}{' '}
                          納付済
                        </div>
                      )}
                    </TableCell>

                    {/* 立順入力フォーム */}
                    <TableCell className="align-top pt-3">
                      <div className="space-y-2">
                        {/* 午前 */}
                        <div
                          className={`flex items-center gap-2 p-2 rounded-lg border transition-colors ${
                            isMorningDuplicate
                              ? 'bg-red-50/90 border-red-300 text-red-950'
                              : 'bg-slate-50 border-slate-200'
                          }`}
                        >
                          <span className="text-[10px] font-bold text-slate-700 w-12 flex items-center gap-0.5">
                            <Sun className="w-3 h-3 text-amber-500" /> 午前
                          </span>
                          <div className="flex items-center gap-1">
                            <span className="text-[10px] text-slate-500">
                              組:
                            </span>
                            <input
                              type="number"
                              min={1}
                              placeholder="組"
                              value={morningAssign.standGroup ?? ''}
                              onChange={(e) => {
                                const val =
                                  e.target.value.trim() === ''
                                    ? null
                                    : Math.max(1, Number(e.target.value));
                                handleAssignmentChange(
                                  p.id,
                                  'morning',
                                  'standGroup',
                                  val,
                                );
                              }}
                              className={`w-14 p-1 text-center rounded text-xs font-bold font-mono outline-none ${
                                isMorningDuplicate
                                  ? 'bg-white border border-red-300 text-red-900 focus:border-red-500'
                                  : 'bg-white border border-slate-300 text-slate-900 focus:border-slate-900'
                              }`}
                            />
                          </div>
                          <div className="flex items-center gap-1">
                            <span className="text-[10px] text-slate-500">
                              立順:
                            </span>
                            <select
                              value={morningAssign.standOrder ?? ''}
                              onChange={(e) => {
                                const val =
                                  e.target.value === ''
                                    ? null
                                    : (Number(
                                        e.target.value,
                                      ) as StandOrderIndex);
                                handleAssignmentChange(
                                  p.id,
                                  'morning',
                                  'standOrder',
                                  val,
                                );
                              }}
                              className={`p-1 rounded text-xs font-bold outline-none ${
                                isMorningDuplicate
                                  ? 'bg-white border border-red-300 text-red-900 focus:border-red-500'
                                  : 'bg-white border border-slate-300 text-slate-900 focus:border-slate-900'
                              }`}
                            >
                              <option value="">未設定</option>
                              <option value={1}>1番 (大前)</option>
                              <option value={2}>2番 (二的)</option>
                              <option value={3}>3番 (中)</option>
                              <option value={4}>4番 (落前)</option>
                              <option value={5}>5番 (落)</option>
                            </select>
                          </div>
                          {isMorningDuplicate && (
                            <span className="text-[9px] font-bold text-red-600 shrink-0 ml-auto flex items-center gap-0.5">
                              <AlertTriangle className="w-2.5 h-2.5" /> 重複
                            </span>
                          )}
                        </div>

                        {/* 午後 */}
                        <div
                          className={`flex items-center gap-2 p-2 rounded-lg border transition-colors ${
                            isAfternoonDuplicate
                              ? 'bg-red-50/90 border-red-300 text-red-950'
                              : 'bg-amber-50/60 border-amber-200'
                          }`}
                        >
                          <span className="text-[10px] font-bold text-amber-900 w-12 flex items-center gap-0.5">
                            <Moon className="w-3 h-3 text-slate-700" /> 午後
                          </span>
                          <div className="flex items-center gap-1">
                            <span className="text-[10px] text-amber-800">
                              組:
                            </span>
                            <input
                              type="number"
                              min={1}
                              placeholder="組"
                              value={afternoonAssign.standGroup ?? ''}
                              onChange={(e) => {
                                const val =
                                  e.target.value.trim() === ''
                                    ? null
                                    : Math.max(1, Number(e.target.value));
                                handleAssignmentChange(
                                  p.id,
                                  'afternoon',
                                  'standGroup',
                                  val,
                                );
                              }}
                              className={`w-14 p-1 text-center rounded text-xs font-bold font-mono outline-none ${
                                isAfternoonDuplicate
                                  ? 'bg-white border border-red-300 text-red-900 focus:border-red-500'
                                  : 'bg-white border border-amber-300 text-slate-900 focus:border-amber-600'
                              }`}
                            />
                          </div>
                          <div className="flex items-center gap-1">
                            <span className="text-[10px] text-amber-800">
                              立順:
                            </span>
                            <select
                              value={afternoonAssign.standOrder ?? ''}
                              onChange={(e) => {
                                const val =
                                  e.target.value === ''
                                    ? null
                                    : (Number(
                                        e.target.value,
                                      ) as StandOrderIndex);
                                handleAssignmentChange(
                                  p.id,
                                  'afternoon',
                                  'standOrder',
                                  val,
                                );
                              }}
                              className={`p-1 rounded text-xs font-bold outline-none ${
                                isAfternoonDuplicate
                                  ? 'bg-white border border-red-300 text-red-900 focus:border-red-500'
                                  : 'bg-white border border-amber-300 text-slate-900 focus:border-amber-600'
                              }`}
                            >
                              <option value="">未設定</option>
                              <option value={1}>1番 (大前)</option>
                              <option value={2}>2番 (二的)</option>
                              <option value={3}>3番 (中)</option>
                              <option value={4}>4番 (落前)</option>
                              <option value={5}>5番 (落)</option>
                            </select>
                          </div>
                          {isAfternoonDuplicate && (
                            <span className="text-[9px] font-bold text-red-600 shrink-0 ml-auto flex items-center gap-0.5">
                              <AlertTriangle className="w-2.5 h-2.5" /> 重複
                            </span>
                          )}
                        </div>
                      </div>
                    </TableCell>

                    {/* 【立順保存ボタン】午前午後設定完了でアクティブ化 */}
                    <TableCell className="text-center align-top pt-4">
                      <div className="flex flex-col items-center gap-1">
                        <Button
                          type="button"
                          size="sm"
                          disabled={isSaving || !canSave}
                          onClick={() => handleSaveParticipantSettings(p)}
                          className={`h-8 px-3 font-bold text-xs rounded-xl shadow-2xs transition-all flex items-center gap-1 ${
                            canSave
                              ? 'bg-emerald-600 hover:bg-emerald-500 text-white animate-pulse'
                              : isSavedInDb
                                ? 'bg-slate-100 text-slate-400 border border-slate-200 cursor-default shadow-none'
                                : 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed shadow-none'
                          }`}
                          title={
                            !isFullySelected
                              ? '午前・午後の組番号と立順をすべて選択してください'
                              : !isDirty
                                ? '変更はありません（保存完了済み）'
                                : isAssignmentDuplicate
                                  ? '立順が重複しているため保存できません'
                                  : '立ち順をFirestoreに確定保存します'
                          }
                        >
                          {isSaving ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : isSavedInDb ? (
                            <>
                              <Check className="w-3.5 h-3.5 text-emerald-600" />
                              保存済
                            </>
                          ) : (
                            <>
                              <Save className="w-3.5 h-3.5" />
                              保存
                            </>
                          )}
                        </Button>

                        {/* 保存状態のステータス明示 */}
                        {isFullySelected && isDirty && (
                          <span className="text-[9px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.2 rounded">
                            未保存の変更あり
                          </span>
                        )}
                        {!isFullySelected && (
                          <span className="text-[9px] font-medium text-slate-400">
                            未選択あり
                          </span>
                        )}
                      </div>
                    </TableCell>

                    {/* 【メール送信ボタン】立順保存完了後のみアクティブ化 */}
                    <TableCell className="text-center align-top pt-4">
                      <div className="flex flex-col items-center gap-1.5">
                        <Button
                          type="button"
                          size="sm"
                          disabled={isSendingQr || !canSendEmail}
                          onClick={() => handleSendSingleQr(p)}
                          className={`h-8 px-3 rounded-xl text-xs font-bold transition-all shadow-2xs active:scale-95 flex items-center gap-1 ${
                            canSendEmail
                              ? isQrSent
                                ? 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50'
                                : 'bg-slate-900 hover:bg-slate-800 text-white'
                              : 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed shadow-none'
                          }`}
                          title={
                            !p.isPaid
                              ? '参加費の入金承認が必要です'
                              : !isFullySelected
                                ? '午前・午後の立ち順設定が必要です'
                                : isDirty
                                  ? '立順の変更が保存されていません。先に「保存」を押してください'
                                  : '選手情報一体型QRカードを添付して案内メールを送信'
                          }
                        >
                          {isSendingQr ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : isQrSent ? (
                            <>
                              <RefreshCw className="w-3.5 h-3.5 text-slate-500" />
                              再送信
                            </>
                          ) : (
                            <>
                              <QrCode
                                className={`w-3.5 h-3.5 ${
                                  canSendEmail
                                    ? 'text-amber-400'
                                    : 'text-slate-400'
                                }`}
                              />
                              メール送信
                            </>
                          )}
                        </Button>

                        {/* 非活性理由の明示（フールプルーフ表示） */}
                        {!canSendEmail && (
                          <div className="flex flex-col items-center gap-0.5">
                            {!p.isPaid && (
                              <span className="text-[9px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.2 rounded">
                                要 入金承認
                              </span>
                            )}
                            {!isFullySelected && (
                              <span className="text-[9px] font-bold text-rose-700 bg-rose-50 border border-rose-200 px-1.5 py-0.2 rounded">
                                要 立順設定
                              </span>
                            )}
                            {isFullySelected && isDirty && (
                              <span className="text-[9px] font-bold text-amber-700 bg-amber-50 border border-amber-300 px-1.5 py-0.2 rounded animate-pulse">
                                要 先に立順保存
                              </span>
                            )}
                          </div>
                        )}

                        {/* 送信状態バッジ */}
                        {isQrSent && (
                          <span className="text-[10px] font-bold text-emerald-700 flex items-center gap-0.5">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                            送信済 (
                            {p.qrSentAt
                              ? new Date(p.qrSentAt).toLocaleTimeString(
                                  'ja-JP',
                                  {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  },
                                )
                              : '完了'}
                            )
                          </span>
                        )}

                        {isQrFailed && (
                          <span
                            className="text-[10px] font-bold text-red-600 flex items-center gap-0.5"
                            title={p.qrSentError || ''}
                          >
                            <AlertCircle className="w-3.5 h-3.5 text-red-600" />
                            送信失敗
                          </span>
                        )}

                        {!isQrSent && !isQrFailed && canSendEmail && (
                          <span className="text-[10px] text-slate-500 flex items-center gap-0.5">
                            <Clock className="w-2.5 h-2.5" /> 送信準備完了
                          </span>
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
    </main>
  );
}
