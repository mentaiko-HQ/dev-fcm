/**
 * 【Firebase Cloud Functions v2: 試合進行・招集ステータス連動型 FCM自動プッシュ通知トリガー】
 *
 * 役割:
 * - Firestore の `matches/{matchId}` ドキュメントの書き込み (onDocumentWritten) を常時監視。
 * - 本部管理画面（MatchControlPanel.tsx）等で `activeCallGroup`（現在招集中の組）または
 *   `currentStandGroup` が更新された際、該当する組の選手および所属チームのFCMトークンを抽出し、
 *   Firebase Cloud Messaging (FCM) を介してプッシュ通知を自動一括配信。
 *
 * フールプルーフ設計（事故前・対人間）:
 * - 招集対象の組番号やステージ番号が未定義、または無効値（0以下）の場合は処理を即座に安全終了（誤爆防止）。
 * - 棄権（ABSENT）または辞退（WITHDRAWN）となった選手の端末には通知を送信しないよう厳格にフィルタリング。
 * - 重複するFCMトークンを Set構造 で排除し、同一端末への過剰な通知送信を防止。
 *
 * フェイルセーフ設計（事故後・対故障）:
 * - FCM送信時に一部のトークンが無効化（messaging/registration-token-not-registered等）されていた場合でも、
 *   全体の処理がクラッシュしないよう個別例外をキャッチして成功・失敗数を分けて記録。
 * - 送信結果の詳細（成功数・失敗数・エラー詳細）を `matches/{matchId}/call_logs` サブコレクションへ確実に書き込み。
 */

import { setGlobalOptions } from 'firebase-functions/v2';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';

// サービス初期化
if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const messaging = admin.messaging();

// グローバルオプションの設定（東京リージョン固定）
setGlobalOptions({ region: 'asia-northeast1' });

interface MatchDocumentData {
  title?: string;
  currentRound?: number;
  currentStandGroup?: number;
  activeCallRound?: number;
  activeCallGroup?: number;
  [key: string]: unknown;
}

interface UserDocumentData {
  fcmToken?: string;
  selectedEntryId?: string;
  participantId?: string;
  teamId?: string;
  teamName?: string;
  organization?: string;
  [key: string]: unknown;
}

interface EntryDocumentData {
  bibNumber?: number;
  name?: string;
  organization?: string;
  checkInStatus?: string;
  qualificationStatus?: string;
  standAssignments?: Record<
    number,
    { standGroup?: number | null; standOrder?: number | null }
  >;
  [key: string]: unknown;
}

const STANDS_PER_GROUP = 2;

function getStandNumbersByGroup(groupNumber: number): [number, number] {
  const safeGroup = Math.max(1, Math.floor(groupNumber));
  const firstStand = (safeGroup - 1) * STANDS_PER_GROUP + 1;
  const secondStand = safeGroup * STANDS_PER_GROUP;
  return [firstStand, secondStand];
}

function getStageName(round: number): string {
  switch (round) {
    case 1:
      return '第1ステージ (午前・一手)';
    case 2:
      return '第2ステージ (午後・一手)';
    case 3:
      return '第3ステージ (午後・四矢)';
    default:
      return `第${round}ステージ`;
  }
}

/**
 * 試合進行ドキュメントの更新をトリガーにFCMプッシュ通知を配信するCloud Function (v2)
 */
export const onMatchProgressUpdated = onDocumentWritten(
  'matches/{matchId}',
  async (event) => {
    const snap = event.data;
    if (!snap) {
      console.log('【FCMトリガー】スナップショットが存在しません。');
      return;
    }

    const beforeData = (
      snap.before.exists ? snap.before.data() : {}
    ) as MatchDocumentData;
    const afterData = (
      snap.after.exists ? snap.after.data() : {}
    ) as MatchDocumentData;

    const matchId = event.params.matchId;

    const newActiveGroup = afterData.activeCallGroup;
    const oldActiveGroup = beforeData.activeCallGroup;

    // フールプルーフ：招集組が新しく設定された瞬間（または変更された瞬間）のみ発火
    if (!newActiveGroup || newActiveGroup <= 0) {
      return;
    }
    if (newActiveGroup === oldActiveGroup) {
      // 招集組に変更がない場合は重複発火を防止して終了
      return;
    }

    const round = Number(
      afterData.activeCallRound ?? afterData.currentRound ?? 1,
    );
    const stageName = getStageName(round);
    const [firstStand, secondStand] = getStandNumbersByGroup(newActiveGroup);

    console.log(
      `【FCM自動通知】試合進行検知: ${matchId} / ${stageName} 第${newActiveGroup}組 (第${firstStand}・${secondStand}立) の招集発火`,
    );

    try {
      // 1. entries コレクションから該当組に所属する有効な選手を抽出
      const entriesSnap = await db.collection('entries').get();
      const targetParticipantIds = new Set<string>();
      const targetOrganizations = new Set<string>();

      entriesSnap.forEach((docSnap) => {
        const entry = docSnap.data() as EntryDocumentData;
        if (
          entry.checkInStatus === 'ABSENT' ||
          entry.qualificationStatus === 'WITHDRAWN'
        ) {
          return;
        }

        const assignments = entry.standAssignments || {};
        const st = assignments[round]?.standGroup;

        if (st === firstStand || st === secondStand) {
          targetParticipantIds.add(docSnap.id);
          if (entry.organization) {
            targetOrganizations.add(entry.organization.trim());
          }
        }
      });

      console.log(
        `【FCM自動通知】対象選手数: ${targetParticipantIds.size}名, 対象所属数: ${targetOrganizations.size}団体`,
      );

      // 2. users コレクションから FCM トークンを収集（3つの紐付け経路すべてに対応）
      const usersSnap = await db.collection('users').get();
      const tokenSet = new Set<string>();

      usersSnap.forEach((docSnap) => {
        const user = docSnap.data() as UserDocumentData;
        const token =
          typeof user.fcmToken === 'string' ? user.fcmToken.trim() : '';
        if (!token) return;

        const entryKey = user.selectedEntryId || user.participantId;
        const teamKey = user.teamId || user.teamName || user.organization;

        const isMatchEntry =
          entryKey && targetParticipantIds.has(String(entryKey));
        const isMatchOrg =
          teamKey && targetOrganizations.has(String(teamKey).trim());

        if (isMatchEntry || isMatchOrg) {
          tokenSet.add(token);
        }
      });

      const tokens = Array.from(tokenSet);
      console.log(
        `【FCM自動通知】有効な配信先FCMトークン数: ${tokens.length}件`,
      );

      if (tokens.length === 0) {
        console.log(
          '【FCM自動通知】配信対象のトークンが見つかりませんでした。',
        );
        await db
          .collection('matches')
          .doc(matchId)
          .collection('call_logs')
          .add({
            matchId,
            round,
            standGroup: newActiveGroup,
            title: `【招集】${stageName} 第${newActiveGroup}組`,
            body: `${stageName} 第${newActiveGroup}組（第${firstStand}立・第${secondStand}立）の選手は招集所へお集まりください。`,
            targetPlayerCount: targetParticipantIds.size,
            tokensFoundCount: 0,
            sentSuccessCount: 0,
            sentFailureCount: 0,
            status: 'SUCCESS',
            triggerType: 'AUTO_PROGRESS',
            errorDetail: 'FCMトークン登録端末なし',
            createdAt: Date.now(),
          });
        return;
      }

      // 3. FCM マルチキャスト配信（一度に最大500件ずつ送信）
      const titleText = `【招集呼出】第${newActiveGroup}組（第${firstStand}・${secondStand}立）`;
      const bodyText = `${stageName} 第${newActiveGroup}組（第${firstStand}立・第${secondStand}立）の選手は控席・招集所へお集まりください。`;

      let successCount = 0;
      let failureCount = 0;

      // 500件ずつのバッチに分割
      const batchSize = 500;
      for (let i = 0; i < tokens.length; i += batchSize) {
        const chunk = tokens.slice(i, i + batchSize);
        const message: admin.messaging.MulticastMessage = {
          tokens: chunk,
          notification: {
            title: titleText,
            body: bodyText,
          },
          data: {
            click_action: '/standby',
            round: String(round),
            standGroup: String(newActiveGroup),
          },
          webpush: {
            notification: {
              icon: '/favicon.ico',
              badge: '/favicon.ico',
              requireInteraction: true,
            },
          },
        };

        try {
          const response = await messaging.sendEachForMulticast(message);
          successCount += response.successCount;
          failureCount += response.failureCount;

          if (response.failureCount > 0) {
            response.responses.forEach((resp, idx) => {
              if (!resp.success) {
                console.warn(
                  `【FCM送信失敗】token[${i + idx}] error:`,
                  resp.error?.message,
                );
              }
            });
          }
        } catch (chunkErr) {
          console.error('【FCM送信チャンク例外】:', chunkErr);
          failureCount += chunk.length;
        }
      }

      console.log(
        `【FCM自動通知完了】成功: ${successCount}件, 失敗: ${failureCount}件`,
      );

      // 4. call_logs サブコレクションへ送信実績を記録（フェイルセーフ監査ログ）
      await db
        .collection('matches')
        .doc(matchId)
        .collection('call_logs')
        .add({
          matchId,
          round,
          standGroup: newActiveGroup,
          title: titleText,
          body: bodyText,
          targetPlayerCount: targetParticipantIds.size,
          tokensFoundCount: tokens.length,
          sentSuccessCount: successCount,
          sentFailureCount: failureCount,
          status: failureCount === 0 ? 'SUCCESS' : 'PARTIAL',
          triggerType: 'AUTO_PROGRESS',
          errorDetail:
            failureCount > 0 ? '一部の端末への送信に失敗しました' : null,
          createdAt: Date.now(),
        });
    } catch (err) {
      console.error('【FCM自動通知トリガー重大例外】:', err);
      // フェイルセーフ：エラー発生時もクラッシュさせずログに記録
      await db
        .collection('matches')
        .doc(matchId)
        .collection('call_logs')
        .add({
          matchId,
          round: Number(afterData.activeCallRound || 1),
          standGroup: newActiveGroup,
          title: '【エラー】自動招集通知の送信中に例外が発生しました',
          body: String(err),
          targetPlayerCount: 0,
          tokensFoundCount: 0,
          sentSuccessCount: 0,
          sentFailureCount: 0,
          status: 'FAILED',
          triggerType: 'AUTO_PROGRESS',
          errorDetail: String(err),
          createdAt: Date.now(),
        });
    }
  },
);
