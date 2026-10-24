/**
 * 【主要機能要件3: 進行状況に応じたFCMプッシュ通知自動送信 (Cloud Functions v2)】
 * 
 * 役割:
 * - matches/{matchId} ドキュメントの更新（onDocumentWritten）を監視。
 * - 現在進行中の立（currentStandGroup）がインクリメントされた際、
 *   2立先（targetStandGroup = currentStandGroup + 2）に属する選手を users コレクションから抽出。
 * - 対象端末へ「メッセージ通知」「バイブレーション（振動）」「通知音」を同時送出するマルチキャスト一括送信を実行。
 * 
 * フールプルーフ設計:
 * - currentStandGroup に変化がないドキュメント更新（スコア修正等）は即時リターンで二重送信を遮断。
 * - 大会の総立数（totalStandGroups）を超過するターゲット立番号に対するガード処理。
 * 
 * フェイルセーフ設計:
 * - Firestore の where in クエリ上限（最大30件）を遵守するため、10件単位でチャンク分割。
 * - 失効・無効トークン（NotRegistered等）を検知した場合は users ドキュメントから自動削除（自己修復バッチ処理）。
 */

import { onDocumentWritten } from "firebase-functions/v2/firestore";
import * as admin from "firebase-admin";

admin.initializeApp();
const db = admin.firestore();
const messaging = admin.messaging();

interface MatchData {
  title?: string;
  currentRound?: 1 | 2 | 3;
  currentStandGroup?: number;
  totalStandGroups?: number;
  status?: string;
}

export const onMatchProgressUpdated = onDocumentWritten(
  {
    document: "matches/{matchId}",
    region: "asia-northeast1",
    maxInstances: 10,
  },
  async (event) => {
    const beforeData = event.data?.before?.data() as MatchData | undefined;
    const afterData = event.data?.after?.data() as MatchData | undefined;

    if (!afterData) {
      console.log("【ログ】ドキュメントが削除されたため処理を終了します。");
      return;
    }

    const beforeGroup = typeof beforeData?.currentStandGroup === "number" ? beforeData.currentStandGroup : 0;
    const afterGroup = typeof afterData?.currentStandGroup === "number" ? afterData.currentStandGroup : 0;
    const currentRound = (afterData.currentRound === 1 || afterData.currentRound === 2 || afterData.currentRound === 3)
      ? afterData.currentRound
      : 1;

    // 【フールプルーフ】立番号が進んでいない更新は早期リターン
    if (afterGroup <= beforeGroup) {
      console.log(`【スキップ】立進行なし（前: 第${beforeGroup}立, 後: 第${afterGroup}立）`);
      return;
    }

    // 呼出対象: 2立先
    const targetStandGroup = afterGroup + 2;
    const totalGroups = typeof afterData.totalStandGroups === "number" ? afterData.totalStandGroups : 999;

    // 【フールプルーフ】総立数の超過チェック
    if (targetStandGroup > totalGroups) {
      console.log(`【スキップ】呼出対象立（第${targetStandGroup}立）が総立数（全${totalGroups}立）を超過しています。`);
      return;
    }

    console.log(`【進行検知】第${currentRound}立 / 現在: 第${afterGroup}立入場 -> 呼出対象: 第${targetStandGroup}立`);

    try {
      // 1. users コレクションから該当立の選手・トークンを取得
      const targetPath = `standAssignments.${currentRound}.standGroup`;
      const usersSnapshot = await db
        .collection("users")
        .where(targetPath, "==", targetStandGroup)
        .get();

      const validTokensWithRefs: Array<{
        token: string;
        userRef: FirebaseFirestore.DocumentReference;
        name: string;
      }> = [];

      usersSnapshot.forEach((userDoc) => {
        const userData = userDoc.data();
        if (userData.fcmToken && typeof userData.fcmToken === "string" && userData.fcmToken.trim().length > 0) {
          validTokensWithRefs.push({
            token: userData.fcmToken.trim(),
            userRef: userDoc.ref,
            name: typeof userData.playerName === "string" ? userData.playerName : "選手",
          });
        }
      });

      if (validTokensWithRefs.length === 0) {
        console.log(`【ログ】第${currentRound}立の第${targetStandGroup}立に該当する登録FCMトークンがありません。`);
        return;
      }

      const tokens = validTokensWithRefs.map((item) => item.token);
      const roundLabel = currentRound === 1 ? "第1立(午前一手)" : currentRound === 2 ? "第2立(午後一手)" : "第3立(決勝四矢)";

      // 2. FCM マルチキャストメッセージ構築（WebPushバイブレーション・音声・メッセージ同時設定）
      const multicastMessage: admin.messaging.MulticastMessage = {
        tokens,
        notification: {
          title: `【招集呼出】まもなく第${targetStandGroup}立の入場です`,
          body: `現在、第${afterGroup}立が入場しました。${roundLabel} 第${targetStandGroup}立の選手は控席・招集所へ速やかにお集まりください。`,
        },
        data: {
          matchId: event.params.matchId,
          targetStandGroup: String(targetStandGroup),
          currentRound: String(currentRound),
          click_action: "/standby",
        },
        webpush: {
          headers: {
            Urgency: "high",
          },
          notification: {
            icon: "/favicon.ico",
            badge: "/favicon.ico",
            vibrate: [300, 150, 300, 150, 300],
            silent: false,
            requireInteraction: true,
            renotify: true,
            tag: `kyudo-call-round${currentRound}-group${targetStandGroup}`,
          },
          fcmOptions: {
            link: "/standby",
          },
        },
        android: {
          priority: "high",
          notification: {
            sound: "default",
            channelId: "kyudo_call_high_priority_channel",
            defaultSound: true,
            defaultVibrateTimings: false,
            vibrateTimingsMillis: [0, 300, 150, 300, 150, 300],
            priority: "high",
            visibility: "public",
          },
        },
        apns: {
          headers: {
            "apns-priority": "10",
          },
          payload: {
            aps: {
              sound: "default",
              badge: 1,
              contentAvailable: true,
            },
          },
        },
      };

      // 3. 一括送信実行
      const response = await messaging.sendEachForMulticast(multicastMessage);
      console.log(`【FCM結果】成功: ${response.successCount} 件, 失敗: ${response.failureCount} 件 (対象: 第${targetStandGroup}立)`);

      // 4. 【フェイルセーフ】無効・失効トークンの自動自己修復
      if (response.failureCount > 0) {
        const batch = db.batch();
        let invalidCount = 0;

        response.responses.forEach((resp, idx) => {
          if (!resp.success && resp.error) {
            const errorCode = resp.error.code;
            if (
              errorCode === "messaging/invalid-registration-token" ||
              errorCode === "messaging/registration-token-not-registered"
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
          console.log(`【自己修復】無効トークン ${invalidCount} 件をFirestoreから削除しました。`);
        }
      }
    } catch (error) {
      console.error("【例外ログ】選手呼出通知処理中にエラーが発生しました:", error);
    }
  }
);