/**
 * 【エントリー照会・入金承認・立順編成・QRコード配信専用コンソール】
 * /admin/check パスに対応するページコンポーネント。
 *
 * 役割:
 * - エントリーデータのリアルタイム購読および一覧表示。
 * - 参加費納付（isPaid）の状態トグル更新（楽観的UI更新とロールバック機構）。
 * - 選手数無制限の動的立数（calculateTotalStands）に基づいた午前・午後の立順インライン編集。
 * - フールプルーフ: 重複や未選択時の保存ブロック、未保存変更時の送信遮断。
 * - フェイルセーフ: APIタイムアウト（AbortController）やFirestore書き込み失敗時のエラーハンドリング。
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
  calculateTotalStands,
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

  const [participants, setParticipants] = useState<Participant[]>([]);
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

  const [searchTerm, setSearchTerm] = useState<string>('');
  const [filterPaid, setFilterPaid] = useState<'ALL' | 'PAID' | 'UNPaid'>(
    'ALL',
  );
  const [filterQr, setFilterQr] = useState<'ALL' | 'SENT' | 'UNSENT'>('ALL');
  const [filterStand, setFilterStand] = useState<
    'ALL' | 'ASSIGNED' | 'UNASSIGNED'
  >('ALL');

  // Firestoreからエントリーデータを購読し、Participant型へ安全にマッピング
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
            isSokuchu: Boolean(raw.isSokuchu), // 必須プロパティ: 束中フラグ
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

  const calculatedTotalStands = useMemo(() => {
    return calculateTotalStands(participants.length);
  }, [participants.length]);

  const totalStands = useMemo(() => {
    let maxStand = 1;
    participants.forEach((p) => {
      const mS = p.standAssignments[1]?.standGroup;
      const aS = p.standAssignments[2]?.standGroup;
      if (mS && mS > maxStand) maxStand = mS;
      if (aS && aS > maxStand) maxStand = aS;
    });
    return Math.max(calculatedTotalStands, maxStand);
  }, [calculatedTotalStands, participants]);

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
        mLabels.push(`第${g}立-${o}番 (${ids.length}名)`);
      }
    });

    const aDupIds = new Set<string>();
    const aLabels: string[] = [];
    aCounts.forEach((ids, key) => {
      if (ids.length > 1) {
        ids.forEach((id) => aDupIds.add(id));
        const [g, o] = key.split('_');
        aLabels.push(`第${g}立-${o}番 (${ids.length}名)`);
      }
    });

    return {
      duplicateMorningPlayerIds: mDupIds,
      duplicateAfternoonPlayerIds: aDupIds,
      duplicateMorningSlotLabels: mLabels,
      duplicateAfternoonSlotLabels: aLabels,
    };
  }, [participants]);

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
        `【No.${participant.bibNumber} ${participant.name} 選手】立順が未設定です。設定後に「保存」を行ってください。`,
      );
      return;
    }

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
      <div className="w-full flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white border border-slate-200/80 p-6 rounded-2xl shadow-sm">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold bg-slate-900 text-white px-3 py-1 rounded-full flex items-center gap-1 shadow-2xs">
              <QrCode className="w-3.5 h-3.5 text-amber-400" />{' '}
              エントリー・QR管理
            </span>
          </div>
          <h1 className="text-xl md:text-2xl font-black text-slate-900 pt-1">
            入金確認・立順編成・正式QRコード発行
          </h1>
          <p className="text-xs text-slate-500 font-medium">
            登録選手（現在: <strong>{participants.length}名</strong>
            ）から必要立数（全 <strong>{totalStands}立</strong>
            ）を動的に自動計算しています。
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

      <div className="w-full grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-2xs space-y-1">
          <span className="text-xs font-bold text-slate-500 flex items-center gap-1.5">
            <Users className="w-4 h-4 text-slate-600" /> 総エントリー数
          </span>
          <div className="text-2xl font-black text-slate-900 font-mono">
            {stats.total}{' '}
            <span className="text-xs font-normal text-slate-400">
              名 (全 {totalStands} 立)
            </span>
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

      <div className="w-full flex flex-col md:flex-row md:items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs">
        <div className="relative flex-1 max-w-lg">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="選手名・ふりがな・ゼッケン・所属で検索..."
            className="w-full pl-9 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 placeholder:text-slate-400 outline-none focus:bg-white focus:border-slate-900 font-medium transition-colors"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <select
            value={filterPaid}
            onChange={(e) =>
              setFilterPaid(e.target.value as 'ALL' | 'PAID' | 'UNPaid')
            }
            className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-700 font-bold outline-none cursor-pointer"
          >
            <option value="ALL">入金: すべて</option>
            <option value="PAID">入金承認済のみ</option>
            <option value="UNPaid">未納のみ</option>
          </select>

          <select
            value={filterQr}
            onChange={(e) =>
              setFilterQr(e.target.value as 'ALL' | 'SENT' | 'UNSENT')
            }
            className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-700 font-bold outline-none cursor-pointer"
          >
            <option value="ALL">QR: すべて</option>
            <option value="SENT">QR送信済</option>
            <option value="UNSENT">QR未送信</option>
          </select>
        </div>
      </div>

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
                立順設定
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

                const morningAssign = p.standAssignments[1] || {
                  standGroup: null,
                  standOrder: null,
                };
                const afternoonAssign = p.standAssignments[2] || {
                  standGroup: null,
                  standOrder: null,
                };

                const isFullySelected =
                  morningAssign.standGroup !== null &&
                  morningAssign.standOrder !== null &&
                  afternoonAssign.standGroup !== null &&
                  afternoonAssign.standOrder !== null;

                const currentKey = createAssignmentKey(p.standAssignments);
                const savedKey = savedAssignmentsMap[p.id] || '';
                const isDirty = currentKey !== savedKey;
                const isSavedInDb = isFullySelected && !isDirty;
                const canSave = isFullySelected && isDirty;
                const canSendEmail = p.isPaid && isSavedInDb;

                return (
                  <TableRow
                    key={p.id}
                    className="hover:bg-slate-50/70 transition-colors"
                  >
                    <TableCell className="font-mono font-black text-sm text-slate-900 align-top pt-4">
                      No.{p.bibNumber}
                    </TableCell>

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
                    </TableCell>

                    <TableCell className="align-top pt-4 max-w-[200px]">
                      <div className="font-bold text-slate-800 text-xs">
                        {p.representativeName || '未登録'} 様
                      </div>
                      <div className="text-[11px] text-slate-500 font-mono flex items-center gap-1 mt-1 truncate">
                        <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span>{p.representativeEmail || '未登録'}</span>
                      </div>
                    </TableCell>

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
                    </TableCell>

                    <TableCell className="align-top pt-3">
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 p-2 rounded-lg border bg-slate-50 border-slate-200">
                          <span className="text-[10px] font-bold text-slate-700 w-12 flex items-center gap-0.5">
                            <Sun className="w-3 h-3 text-amber-500" /> 午前
                          </span>
                          <input
                            type="number"
                            min={1}
                            placeholder="立"
                            value={morningAssign.standGroup ?? ''}
                            onChange={(e) =>
                              handleAssignmentChange(
                                p.id,
                                'morning',
                                'standGroup',
                                e.target.value.trim() === ''
                                  ? null
                                  : Number(e.target.value),
                              )
                            }
                            className="w-14 p-1 text-center rounded text-xs font-bold font-mono outline-none bg-white border border-slate-300"
                          />
                          <select
                            value={morningAssign.standOrder ?? ''}
                            onChange={(e) =>
                              handleAssignmentChange(
                                p.id,
                                'morning',
                                'standOrder',
                                e.target.value === ''
                                  ? null
                                  : (Number(e.target.value) as StandOrderIndex),
                              )
                            }
                            className="p-1 rounded text-xs font-bold outline-none bg-white border border-slate-300"
                          >
                            <option value="">未設定</option>
                            <option value={1}>1番 (大前)</option>
                            <option value={2}>2番 (二的)</option>
                            <option value={3}>3番 (中)</option>
                            <option value={4}>4番 (落前)</option>
                            <option value={5}>5番 (落)</option>
                          </select>
                        </div>

                        <div className="flex items-center gap-2 p-2 rounded-lg border bg-amber-50/60 border-amber-200">
                          <span className="text-[10px] font-bold text-amber-900 w-12 flex items-center gap-0.5">
                            <Moon className="w-3 h-3 text-slate-700" /> 午後
                          </span>
                          <input
                            type="number"
                            min={1}
                            placeholder="立"
                            value={afternoonAssign.standGroup ?? ''}
                            onChange={(e) =>
                              handleAssignmentChange(
                                p.id,
                                'afternoon',
                                'standGroup',
                                e.target.value.trim() === ''
                                  ? null
                                  : Number(e.target.value),
                              )
                            }
                            className="w-14 p-1 text-center rounded text-xs font-bold font-mono outline-none bg-white border border-amber-300"
                          />
                          <select
                            value={afternoonAssign.standOrder ?? ''}
                            onChange={(e) =>
                              handleAssignmentChange(
                                p.id,
                                'afternoon',
                                'standOrder',
                                e.target.value === ''
                                  ? null
                                  : (Number(e.target.value) as StandOrderIndex),
                              )
                            }
                            className="p-1 rounded text-xs font-bold outline-none bg-white border border-amber-300"
                          >
                            <option value="">未設定</option>
                            <option value={1}>1番 (大前)</option>
                            <option value={2}>2番 (二的)</option>
                            <option value={3}>3番 (中)</option>
                            <option value={4}>4番 (落前)</option>
                            <option value={5}>5番 (落)</option>
                          </select>
                        </div>
                      </div>
                    </TableCell>

                    <TableCell className="text-center align-top pt-4">
                      <Button
                        type="button"
                        size="sm"
                        disabled={isSaving || !canSave}
                        onClick={() => handleSaveParticipantSettings(p)}
                        className={`h-8 px-3 font-bold text-xs rounded-xl shadow-2xs transition-all flex items-center gap-1 ${
                          canSave
                            ? 'bg-emerald-600 hover:bg-emerald-500 text-white animate-pulse'
                            : 'bg-slate-100 text-slate-400 border border-slate-200 cursor-default shadow-none'
                        }`}
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
                    </TableCell>

                    <TableCell className="text-center align-top pt-4">
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
                            <QrCode className="w-3.5 h-3.5 text-amber-400" />
                            メール送信
                          </>
                        )}
                      </Button>
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
