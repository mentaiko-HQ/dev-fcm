/**
 * 【選手用スマートフォン向け リアルタイム招集中ステータスバナー】
 *
 * 役割:
 * - Firestore の `matches/{matchId}` ドキュメント (`activeCallRound`, `activeCallGroup`) を `onSnapshot` で常時監視。
 * - 本部（MatchControlPanel）でいずれかの組の「招集ボタン」が押されている間、
 *   選手のスマートフォン画面上に「現在 第N組（第2N-1立・第2N立）招集中」の警告バナーと対象選手名を即座に表示。
 * - 本部が「招集解除」を押すと自動的に待機表示へ切り替わる。
 *
 * フールプルーフ設計（事故前・対人間）:
 * - 組番号だけでなく「第〇立・第〇立」および該当する選手のゼッケン・氏名を一覧表示し、自分の出番かどうかを誤認させない。
 *
 * フェイルセーフ設計（事故後・対故障）:
 * - Webプッシュ通知（FCM）がOS設定等でブロックされている端末でも、画面を開いていればこのバナーで確実に招集を認知可能。
 */

'use client';

import React, { useEffect, useState, useMemo } from 'react';
import {
  collection,
  doc,
  onSnapshot,
  query,
  orderBy,
  FirestoreError,
} from 'firebase/firestore';
import { db, isFirebaseConfigured, isFirestoreAvailable } from '@/lib/firebase';
import {
  StandRoundIndex,
  StandOrderIndex,
  sanitizeStandGroup,
  sanitizeStandOrder,
} from '@/types';
import { BellRing, CheckCircle2, Users } from 'lucide-react';

interface LiveCallStatusBannerProps {
  matchId?: string;
}

interface ActiveCallState {
  activeCallRound: StandRoundIndex | null;
  activeCallGroup: number | null;
}

interface BannerPlayer {
  id: string;
  bibNumber: number;
  name: string;
  organization: string;
  standNumber: number | null;
  standOrder: StandOrderIndex | null;
}

const STANDS_PER_GROUP = 2;

function getStandNumbersByGroup(groupNumber: number): [number, number] {
  const safeGroup = Math.max(1, Math.floor(groupNumber));
  const firstStand = (safeGroup - 1) * STANDS_PER_GROUP + 1;
  const secondStand = safeGroup * STANDS_PER_GROUP;
  return [firstStand, secondStand];
}

function getStageLabel(round: StandRoundIndex): string {
  switch (round) {
    case 1:
      return '第1ステージ (午前・一手 2射)';
    case 2:
      return '第2ステージ (午後・一手 2射)';
    case 3:
      return '第3ステージ (午後・四矢 4射)';
    default:
      return `第${round}ステージ`;
  }
}

export function LiveCallStatusBanner({
  matchId = 'match_2026_mentaiko',
}: LiveCallStatusBannerProps) {
  const isDbReady = isFirebaseConfigured && isFirestoreAvailable(db);

  const [callState, setCallState] = useState<ActiveCallState>({
    activeCallRound: null,
    activeCallGroup: null,
  });
  const [players, setPlayers] = useState<
    Array<{
      id: string;
      bibNumber: number;
      name: string;
      organization: string;
      checkInStatus: string;
      qualificationStatus: string;
      standAssignments: Record<
        StandRoundIndex,
        { standGroup: number | null; standOrder: StandOrderIndex | null }
      >;
    }>
  >([]);

  // 1. matches ドキュメントの招集中ステータスをリアルタイム購読
  useEffect(() => {
    if (!isDbReady) return;

    const matchRef = doc(db, 'matches', matchId);
    const unsubscribe = onSnapshot(
      matchRef,
      (snap) => {
        if (!snap.exists()) return;
        const data = snap.data();
        const rawGroup = data.activeCallGroup;
        const safeGroup =
          typeof rawGroup === 'number' && rawGroup > 0 ? rawGroup : null;
        const rawRound = Number(data.activeCallRound ?? data.currentRound);
        const safeRound: StandRoundIndex | null =
          safeGroup !== null &&
          (rawRound === 1 || rawRound === 2 || rawRound === 3)
            ? (rawRound as StandRoundIndex)
            : null;

        setCallState({
          activeCallRound: safeRound,
          activeCallGroup: safeGroup,
        });
      },
      (err: FirestoreError) => {
        console.error('【LiveCallStatusBanner】matches購読エラー:', err);
      },
    );

    return () => unsubscribe();
  }, [isDbReady, matchId]);

  // 2. entries コレクションを購読し、招集中組の対象選手を特定
  useEffect(() => {
    if (!isDbReady) return;

    const q = query(collection(db, 'entries'), orderBy('bibNumber', 'asc'));
    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        const list: typeof players = [];
        snap.forEach((docSnap) => {
          const raw = docSnap.data();
          const rawAssign = raw.standAssignments || {};
          const pmGroup = sanitizeStandGroup(
            rawAssign[2]?.standGroup ?? rawAssign[3]?.standGroup ?? null,
          );
          const pmOrder = sanitizeStandOrder(
            rawAssign[2]?.standOrder ?? rawAssign[3]?.standOrder ?? null,
          );

          list.push({
            id: docSnap.id,
            bibNumber:
              typeof raw.bibNumber === 'number'
                ? raw.bibNumber
                : Number(raw.bibNumber) || 1,
            name: typeof raw.name === 'string' ? raw.name : '選手',
            organization:
              typeof raw.organization === 'string'
                ? raw.organization
                : '無所属',
            checkInStatus: raw.checkInStatus || 'UNCHECKED',
            qualificationStatus: raw.qualificationStatus || 'ACTIVE',
            standAssignments: {
              1: {
                standGroup: sanitizeStandGroup(
                  rawAssign[1]?.standGroup ?? null,
                ),
                standOrder: sanitizeStandOrder(
                  rawAssign[1]?.standOrder ?? null,
                ),
              },
              2: { standGroup: pmGroup, standOrder: pmOrder },
              3: { standGroup: pmGroup, standOrder: pmOrder },
            },
          });
        });
        setPlayers(list);
      },
      (err: FirestoreError) => {
        console.error('【LiveCallStatusBanner】entries購読エラー:', err);
      },
    );

    return () => unsubscribe();
  }, [isDbReady]);

  // 現在招集中の組に属する選手一覧を算出
  const calledPlayers: BannerPlayer[] = useMemo(() => {
    if (!callState.activeCallGroup || !callState.activeCallRound) return [];
    const round = callState.activeCallRound;
    const [firstStand, secondStand] = getStandNumbersByGroup(
      callState.activeCallGroup,
    );

    return players
      .filter((p) => {
        if (
          p.checkInStatus === 'ABSENT' ||
          p.qualificationStatus === 'WITHDRAWN'
        ) {
          return false;
        }
        const st = p.standAssignments[round]?.standGroup;
        return st === firstStand || st === secondStand;
      })
      .map((p) => ({
        id: p.id,
        bibNumber: p.bibNumber,
        name: p.name,
        organization: p.organization,
        standNumber: p.standAssignments[round]?.standGroup ?? null,
        standOrder: p.standAssignments[round]?.standOrder ?? null,
      }))
      .sort((a, b) => {
        if ((a.standNumber ?? 99) !== (b.standNumber ?? 99)) {
          return (a.standNumber ?? 99) - (b.standNumber ?? 99);
        }
        return (a.standOrder ?? 99) - (b.standOrder ?? 99);
      });
  }, [callState, players]);

  // 招集中の組がない場合は控えめな待機ステータスバーを表示
  if (!callState.activeCallGroup || !callState.activeCallRound) {
    return (
      <div className="w-full bg-white border border-slate-200/80 rounded-2xl px-4 py-3 shadow-2xs flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span className="text-xs font-bold text-slate-700">
            現在、招集呼出中の組はありません
          </span>
        </div>
        <span className="text-[10px] font-mono text-slate-400">
          リアルタイム連動中
        </span>
      </div>
    );
  }

  const [firstStand, secondStand] = getStandNumbersByGroup(
    callState.activeCallGroup,
  );

  return (
    <div className="w-full bg-amber-50 border-2 border-amber-500 rounded-2xl p-4 shadow-md space-y-3 animate-in fade-in">
      <div className="flex items-start sm:items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-xl bg-amber-500 text-slate-950 flex items-center justify-center shrink-0 animate-pulse shadow-2xs">
            <BellRing className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center flex-wrap gap-1.5">
              <span className="text-[10px] font-black bg-slate-900 text-amber-400 px-2 py-0.5 rounded-full">
                ただいま招集中
              </span>
              <span className="text-xs font-bold text-amber-900">
                {getStageLabel(callState.activeCallRound)}
              </span>
            </div>
            <h2 className="text-base sm:text-lg font-black text-slate-950 mt-0.5">
              第 {callState.activeCallGroup} 組（第{firstStand}立・第
              {secondStand}立）の選手は招集所へお集まりください
            </h2>
          </div>
        </div>
      </div>

      {/* 対象選手一覧ピル */}
      {calledPlayers.length > 0 && (
        <div className="bg-white/90 border border-amber-300 rounded-xl p-3 space-y-1.5">
          <div className="text-[11px] font-bold text-amber-900 flex items-center gap-1">
            <Users className="w-3.5 h-3.5 text-amber-700" />
            招集対象選手（{calledPlayers.length}名）
          </div>
          <div className="flex flex-wrap gap-1.5">
            {calledPlayers.map((p) => (
              <span
                key={p.id}
                className="inline-flex items-center gap-1 text-xs font-bold bg-amber-50/80 border border-amber-200 text-slate-900 px-2.5 py-1 rounded-lg"
              >
                <span className="font-mono text-[10px] text-amber-800 font-black">
                  第{p.standNumber}立-{p.standOrder}番
                </span>
                <span className="font-mono text-[11px] text-slate-500">
                  No.{p.bibNumber}
                </span>
                <span>{p.name}</span>
                <span className="text-[10px] text-slate-500 font-normal">
                  ({p.organization})
                </span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
