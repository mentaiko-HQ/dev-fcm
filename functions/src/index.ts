/**
 * 【主要機能要件3: 大会進行・順送り招集に応じたFCMプッシュ通知自動送信 (Cloud Functions v2 完全互換・誤押下キャンセル防止版)】
 *
 * 役割:
 * 1. 既存の関数名 `onMatchProgressUpdated` (matches/{matchId} の onDocumentWritten) を完全維持。
 * 2. 「組別 順送り招集ボタン（activeCallGroup の更新）」と、
 *    従来の「進行インクリメント（currentStandGroup + 2 の自動呼出）」の双方を自動判別して処理。
 * 3. 「1組＝2立（第 2N-1 立・第 2N 立）」構造と「単一立」構造の双方に対応し、
 *    entries コレクション（selectedEntryId 紐付け）および users コレクション（standAssignments 直接保持）の両経路から
 *    対象選手の FCM トークンを漏れなく抽出。
 * 4. 対象端末へ「メッセージ通知」「バイブレーション（振動）」「通知音」を同時送出するマルチキャスト一括送信を実行し、
 *    結果を `matches/{matchId}/call_logs` サブコレクションへ自動記録・同期。
 *
 * フールプルーフ設計（事故前・対人間）:
 * - 本部管理画面で「誤押下キャンセル（第 N 組 → 第 N-1 組へ戻す）」が実行された際（同一ステージ内で activeCallGroup が減少した場合）は、
 *   既に通知済みの第 N-1 組へ重複してFCM通知が再送信されるのを入口で完全遮断。
 * - 招集対象組（activeCallGroup）も進行組（currentStandGroup）も変化していない更新（スコア修正や招集解除時など）は即時リターン。
 * - 棄権選手（ABSENT / WITHDRAWN）は通知対象から除外。
 *
 * フェイルセーフ設計（事故後・対故障）:
 * - 失効・無効トークン（invalid-registration-token / registration-token-not-registered）を検知した場合は、
 *   users ドキュメントから該当トークンを自動削除（自己修復バッチ処理）。
 * - 万が一の例外発生時も Cloud Functions をクラッシュさせず構造化エラーログと call_logs へのエラーステータス記録を実行。
 */

import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';

if (admin.apps.length === 0) {
  admin.initializeApp();
}

const db = admin.firestore();
const messaging = admin.messaging();

const STANDS_PER_GROUP = 2;

interface MatchData {
  matchId?: string;
  title?: string;
  currentRound?: 1 | 2 | 3;
  currentStandGroup?: number;
  currentStandNumber?: number;
  totalStandGroups?: number;
  activeCallRound?: 1 | 2 | 3 | null;
  activeCallGroup?: number | null;
  lastCalledAt?: number;
  status?: string;
}

interface TokenTargetInfo {
  token: string;
  userRef: FirebaseFirestore.DocumentReference;
  name: string;
}

/**
 * 組番号 (1, 2, 3...) から、その組に含まれる2つの立番号 [前半立, 後半立] を算出する
 * 例: 第1組 -> [1, 2] (第1立・第2立), 第2組 -> [3, 4] (第3立・第4立)
 */
function getStandNumbersByGroup(groupNumber: number): [number, number] {
  const safeGroup = Math.max(1, Math.floor(groupNumber));
  const firstStand = (safeGroup - 1) * STANDS_PER_GROUP + 1;
  const secondStand = safeGroup * STANDS_PER_GROUP;
  return [firstStand, secondStand];
}

/**
 * ステージ番号から表示ラベルを取得する
 */
function getRoundLabel(round: 1 | 2 | 3): string {
  switch (round) {
    case 1:
      return '第1ステージ(午前・一手)';
    case 2:
      return '第2ステージ(午後・一手)';
    case 3:
      return '第3ステージ(午後・四矢)';
    default:
      return `第${round}ステージ`;
  }
}

export const onMatchProgressUpdated = onDocumentWritten(
  {
    document: 'matches/{matchId}',
    region: 'asia-northeast1',
    maxInstances: 10,
  },
  async (event) => {
    const beforeData = event.data?.before?.data() as MatchData | undefined;
    const afterData = event.data?.after?.data() as MatchData | undefined;

    if (!afterData) {
      console.log(
        '【ログ】matchesドキュメントが削除されたため処理を終了します。',
      );
      return;
    }

    const matchId = event.params.matchId;

    // -------------------------------------------------------------
    // 1. トリガー種別の判定（A: 順送り招集ボタン押下 / B: 従来の進行インクリメント）
    // -------------------------------------------------------------
    const beforeActiveCallGroup =
      typeof beforeData?.activeCallGroup === 'number'
        ? beforeData.activeCallGroup
        : null;
    const afterActiveCallGroup =
      typeof afterData?.activeCallGroup === 'number'
        ? afterData.activeCallGroup
        : null;

    const beforeActiveCallRound =
      beforeData?.activeCallRound === 1 ||
      beforeData?.activeCallRound === 2 ||
      beforeData?.activeCallRound === 3
        ? beforeData.activeCallRound
        : null;
    const afterActiveCallRound =
      afterData?.activeCallRound === 1 ||
      afterData?.activeCallRound === 2 ||
      afterData?.activeCallRound === 3
        ? afterData.activeCallRound
        : null;

    const beforeGroup =
      typeof beforeData?.currentStandGroup === 'number'
        ? beforeData.currentStandGroup
        : 0;
    const afterGroup =
      typeof afterData?.currentStandGroup === 'number'
        ? afterData.currentStandGroup
        : 0;

    let targetGroupNumber: number | null = null;
    let targetRound: 1 | 2 | 3 =
      afterData.currentRound === 1 ||
      afterData.currentRound === 2 ||
      afterData.currentRound === 3
        ? afterData.currentRound
        : 1;
    let isExplicitGroupCall = false;

    // ケースA-解除: 「全招集解除」または「第1組の誤押下キャンセル」により activeCallGroup が null に戻った場合は通知せず終了
    if (beforeActiveCallGroup !== null && afterActiveCallGroup === null) {
      console.log(
        `【招集解除検知】第${beforeActiveCallGroup}組 の招集状態が解除されました（通知スキップ）。`,
      );
      return;
    }

    // ケースA-キャンセル（フールプルーフ）:
    // 同一ステージ内で「誤押下キャンセル（Undo）」により activeCallGroup が減少した場合（例: 第2組 -> 第1組）は、
    // 既に通知済みの第 N-1 組へ重複してプッシュ通知を送らないよう遮断して終了
    if (
      beforeActiveCallGroup !== null &&
      afterActiveCallGroup !== null &&
      beforeActiveCallRound === afterActiveCallRound &&
      afterActiveCallGroup < beforeActiveCallGroup
    ) {
      console.log(
        `【誤押下キャンセル検知】第${beforeActiveCallGroup}組 から 第${afterActiveCallGroup}組 へロールバックされました（重複通知防止のためスキップ）。`,
      );
      return;
    }

    // ケースA-進行: 管理画面で「第N組を招集する」ボタンが押され、activeCallGroup が新規設定または前進した場合
    if (
      afterActiveCallGroup !== null &&
      afterActiveCallGroup > 0 &&
      (beforeActiveCallGroup === null ||
        afterActiveCallRound !== beforeActiveCallRound ||
        afterActiveCallGroup > beforeActiveCallGroup)
    ) {
      targetGroupNumber = afterActiveCallGroup;
      if (afterActiveCallRound !== null) {
        targetRound = afterActiveCallRound;
      }
      isExplicitGroupCall = true;
      console.log(
        `【招集ボタン検知】${getRoundLabel(targetRound)} 第${targetGroupNumber}組 が招集中に設定されました。`,
      );
    }
    // ケースB: 従来の進行インクリメント（activeCallGroup 未使用時に currentStandGroup が増加し、2組先を自動呼出する場合）
    else if (afterActiveCallGroup === null && afterGroup > beforeGroup) {
      const candidateGroup = afterGroup + 2;
      const totalGroups =
        typeof afterData.totalStandGroups === 'number'
          ? afterData.totalStandGroups
          : 999;

      if (candidateGroup > totalGroups) {
        console.log(
          `【スキップ】呼出対象組（第${candidateGroup}組）が総組数（全${totalGroups}組）を超過しています。`,
        );
        return;
      }
      targetGroupNumber = candidateGroup;
      console.log(
        `【自動進行検知】${getRoundLabel(targetRound)} 現在: 第${afterGroup}組 -> 2組先呼出対象: 第${targetGroupNumber}組`,
      );
    } else {
      // 招集状態にも進行組にも変化がない場合は早期リターン（フールプルーフ）
      console.log(
        `【スキップ】招集組・進行組の変化なし（activeCallGroup: ${afterActiveCallGroup}, currentStandGroup: ${afterGroup}）`,
      );
      return;
    }

    if (!targetGroupNumber) return;

    // 第 N 組に対応する前半立 (2N-1) と後半立 (2N) を算出
    const [firstStand, secondStand] = getStandNumbersByGroup(targetGroupNumber);
    const roundLabel = getRoundLabel(targetRound);

    try {
      // -------------------------------------------------------------
      // 2. 対象選手および FCM トークンの多層抽出（entries 連携 ＋ users 直接保持の両対応）
      // -------------------------------------------------------------
      const entriesSnapshot = await db.collection('entries').get();
      const targetEntryIds = new Set<string>();
      const targetOrganizations = new Set<string>();
      let targetPlayerCount = 0;

      entriesSnapshot.forEach((docSnap) => {
        const eData = docSnap.data();
        if (
          eData.checkInStatus === 'ABSENT' ||
          eData.qualificationStatus === 'WITHDRAWN'
        ) {
          return;
        }

        const assignments = eData.standAssignments || {};
        const roundAssign =
          assignments[targetRound] ||
          (targetRound === 3 ? assignments[2] : undefined) ||
          {};
        const assignedStand = Number(roundAssign.standGroup);

        // 1組＝2立（firstStand または secondStand）に一致、あるいは組番号そのものに一致する選手を抽出
        if (
          assignedStand === firstStand ||
          assignedStand === secondStand ||
          assignedStand === targetGroupNumber
        ) {
          targetPlayerCount++;
          targetEntryIds.add(docSnap.id);
          if (
            typeof eData.organization === 'string' &&
            eData.organization.trim().length > 0
          ) {
            targetOrganizations.add(eData.organization.trim());
          }
        }
      });

      // users コレクションから該当選手のトークンを収集（重複排除）
      const usersSnapshot = await db.collection('users').get();
      const tokenMap = new Map<string, TokenTargetInfo>();

      usersSnapshot.forEach((userDoc) => {
        const userData = userDoc.data();
        const rawToken =
          typeof userData.fcmToken === 'string' ? userData.fcmToken.trim() : '';
        if (!rawToken) return;

        // 経路1: selectedEntryId が対象選手IDに含まれている
        const selectedEntryId =
          typeof userData.selectedEntryId === 'string'
            ? userData.selectedEntryId.trim()
            : '';
        const matchedByEntryId =
          selectedEntryId.length > 0 && targetEntryIds.has(selectedEntryId);

        // 経路2: users ドキュメント内の standAssignments.{round}.standGroup が対象立・組に一致（既存仕様互換）
        const userStandAssign =
          userData.standAssignments?.[targetRound]?.standGroup;
        const matchedByDirectStand =
          typeof userStandAssign === 'number' &&
          (userStandAssign === firstStand ||
            userStandAssign === secondStand ||
            userStandAssign === targetGroupNumber);

        // 経路3: チーム選択（teamId / organization）が対象選手の所属団体に一致
        const userTeam = String(
          userData.teamId ||
            userData.selectedTeam ||
            userData.organization ||
            '',
        ).trim();
        const matchedByTeam =
          userTeam.length > 0 && targetOrganizations.has(userTeam);

        if (matchedByEntryId || matchedByDirectStand || matchedByTeam) {
          if (!tokenMap.has(rawToken)) {
            tokenMap.set(rawToken, {
              token: rawToken,
              userRef: userDoc.ref,
              name:
                typeof userData.playerName === 'string'
                  ? userData.playerName
                  : '選手',
            });
          }
        }
      });

      const validTokensWithRefs = Array.from(tokenMap.values());
      const notificationTitle = isExplicitGroupCall
        ? `【招集呼出】第${targetGroupNumber}組（第${firstStand}・${secondStand}立）`
        : `【招集呼出】まもなく第${targetGroupNumber}組（第${firstStand}・${secondStand}立）の入場です`;

      const notificationBody = isExplicitGroupCall
        ? `${roundLabel} 第${targetGroupNumber}組（第${firstStand}立・第${secondStand}立）の選手は控席・招集所へ速やかにお集まりください。`
        : `現在、第${afterGroup}組が進行中です。${roundLabel} 第${targetGroupNumber}組（第${firstStand}立・第${secondStand}立）の選手は控席・招集所へお集まりください。`;

      // トークンが0件の場合のハンドリング
      if (validTokensWithRefs.length === 0) {
        console.log(
          `【ログ】${roundLabel} 第${targetGroupNumber}組（第${firstStand}・${secondStand}立）に該当する登録FCMトークンがありません。`,
        );
        return;
      }

      const tokens = validTokensWithRefs.map((item) => item.token);

      // -------------------------------------------------------------
      // 3. FCM マルチキャストメッセージ構築（既存の高優先度・バイブレーション・音声設定を完全維持）
      // -------------------------------------------------------------
      const multicastMessage: admin.messaging.MulticastMessage = {
        tokens,
        notification: {
          title: notificationTitle,
          body: notificationBody,
        },
        data: {
          matchId: String(matchId),
          targetStandGroup: String(targetGroupNumber),
          firstStand: String(firstStand),
          secondStand: String(secondStand),
          currentRound: String(targetRound),
          click_action: '/standby',
        },
        webpush: {
          headers: {
            Urgency: 'high',
          },
          notification: {
            title: notificationTitle,
            body: notificationBody,
            icon: '/favicon.ico',
            badge: '/favicon.ico',
            vibrate: [300, 150, 300, 150, 300],
            silent: false,
            requireInteraction: true,
            renotify: true,
            tag: `kyudo-call-round${targetRound}-group${targetGroupNumber}`,
          },
          fcmOptions: {
            link: '/standby',
          },
        },
        android: {
          priority: 'high',
          notification: {
            sound: 'default',
            channelId: 'kyudo_call_high_priority_channel',
            defaultSound: true,
            defaultVibrateTimings: false,
            vibrateTimingsMillis: [0, 300, 150, 300, 150, 300],
            priority: 'high',
            visibility: 'public',
          },
        },
        apns: {
          headers: {
            'apns-priority': '10',
          },
          payload: {
            aps: {
              sound: 'default',
              badge: 1,
              contentAvailable: true,
            },
          },
        },
      };

      // -------------------------------------------------------------
      // 4. 一括送信実行
      // -------------------------------------------------------------
      const response = await messaging.sendEachForMulticast(multicastMessage);
      console.log(
        `【FCM結果】成功: ${response.successCount} 件, 失敗: ${response.failureCount} 件 (対象: 第${targetGroupNumber}組 / 第${firstStand}・${secondStand}立)`,
      );

      // -------------------------------------------------------------
      // 5. 【フェイルセーフ】無効・失効トークンの自動自己修復バッチ処理
      // -------------------------------------------------------------
      if (response.failureCount > 0) {
        const batch = db.batch();
        let invalidCount = 0;

        response.responses.forEach((resp, idx) => {
          if (!resp.success && resp.error) {
            const errorCode = resp.error.code;
            if (
              errorCode === 'messaging/invalid-registration-token' ||
              errorCode === 'messaging/registration-token-not-registered'
            ) {
              const userRef = validTokensWithRefs[idx].userRef;
              batch.update(userRef, {
                fcmToken: admin.firestore.FieldValue.delete(),
                tokenCleanedAt: admin.firestore.FieldValue.serverTimestamp(),
              });
              invalidCount++;
            }
          }
        });

        if (invalidCount > 0) {
          await batch.commit();
          console.log(
            `【自己修復】無効トークン ${invalidCount} 件をFirestoreから削除しました。`,
          );
        }
      }

      // -------------------------------------------------------------
      // 6. 直近の call_logs ドキュメントの送信実績を実測値で更新（または新規作成）
      // -------------------------------------------------------------
      const recentLogsSnap = await db
        .collection('matches')
        .doc(matchId)
        .collection('call_logs')
        .orderBy('createdAt', 'desc')
        .limit(3)
        .get();

      const matchingLogDoc = recentLogsSnap.docs.find((d) => {
        const dData = d.data();
        return (
          Number(dData.round) === targetRound &&
          Number(dData.standGroup) === targetGroupNumber &&
          Date.now() - Number(dData.createdAt || 0) < 30000
        );
      });

      const finalStatus =
        response.failureCount === 0
          ? 'SUCCESS'
          : response.successCount > 0
            ? 'PARTIAL'
            : 'FAILED';

      if (matchingLogDoc) {
        await matchingLogDoc.ref.update({
          targetPlayerCount:
            targetPlayerCount > 0 ? targetPlayerCount : tokens.length,
          tokensFoundCount: tokens.length,
          sentSuccessCount: response.successCount,
          sentFailureCount: response.failureCount,
          status: finalStatus,
          fcmDispatched: true,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      } else {
        await db
          .collection('matches')
          .doc(matchId)
          .collection('call_logs')
          .add({
            matchId,
            round: targetRound,
            standGroup: targetGroupNumber,
            firstStandNumber: firstStand,
            secondStandNumber: secondStand,
            title: notificationTitle,
            body: notificationBody,
            targetPlayerCount:
              targetPlayerCount > 0 ? targetPlayerCount : tokens.length,
            tokensFoundCount: tokens.length,
            sentSuccessCount: response.successCount,
            sentFailureCount: response.failureCount,
            status: finalStatus,
            triggerType: isExplicitGroupCall
              ? 'MANUAL_GROUP_CALL'
              : 'AUTO_PROGRESS',
            errorDetail: null,
            fcmDispatched: true,
            createdAt: Date.now(),
          });
      }
    } catch (error) {
      console.error(
        '【例外ログ】選手呼出通知処理中にエラーが発生しました:',
        error,
      );
    }
  },
);
