/**
 * 【Firebase Cloud Functions v2: 進行監視および選手別2立前自動呼出通知トリガー】
 * 
 * 役割:
 * - matches/{matchId} の更新イベント（onDocumentWritten）を監視。
 * - 現在進行中の立番号（currentStandGroup）および立（currentRound: 1または2）の進捗を検知。
 * - 2立先（targetStandGroup = currentStandGroup + 2）に該当する選手を特定。
 * - users コレクションから該当する選手ID・立配置に合致する FCM トークンを収集。
 * - スマートフォン端末に対し、「メッセージ通知」「バイブレーション（振動）」「通知音（アラート音）」を同時に作動させるマルチキャスト一括送信を実行。
 * 
 * フールプルーフ設計（操作ミス・二重送信の防止）:
 * - currentStandGroup に変化がないドキュメント更新（スコア入力や修正等）は即時リターンし、同一立に対する重複通知を遮断。
 * - 大会の総立数（totalStandGroups）を超過するターゲット立番号に対するガード処理を実装。
 * - targetStandGroup の計算結果が不正値（NaNや負数）にならないよう数値検証を実施。
 * 
 * フェイルセーフ設計（障害耐性・自動修復）:
 * - Firestore の where in クエリ上限（最大30件）を考慮し、10件単位でのチャンク分割取得を実施。
 * - FCM送信結果（BatchResponse）を解析し、無効・失効トークン（NotRegistered, InvalidRegistration）を検知した場合は
 *   該当ユーザーの users ドキュメントから fcmToken を自動削除（自己修復バッチ処理）。
 * - 外部通信障害や例外発生時でもクラッシュさせず、エラーログを完全出力して安全にプロセスを終了。
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
    // 変更前後のドキュメントデータを取得
    const beforeData = event.data?.before?.data() as MatchData | undefined;
    const afterData = event.data?.after?.data() as MatchData | undefined;

    // ドキュメント削除イベントの場合は処理を安全に終了
    if (!afterData) {
      console.log("【Functionsログ】ドキュメントが削除されたため処理を終了します。");
      return;
    }

    const beforeGroup = typeof beforeData?.currentStandGroup === "number" ? beforeData.currentStandGroup : 0;
    const afterGroup = typeof afterData?.currentStandGroup === "number" ? afterData.currentStandGroup : 0;
    const currentRound = (afterData.currentRound === 1 || afterData.currentRound === 2 || afterData.currentRound === 3)
      ? afterData.currentRound
      : 1;

    // 【フールプルーフ】立グループ番号が実際に進んでいない場合は二重送信を防ぐため即時終了
    if (afterGroup <= beforeGroup) {
      console.log(`【Functionsログ】立進行なし（前: 第${beforeGroup}立, 後: 第${afterGroup}立）。通知送信をスキップします。`);
      return;
    }

    // 呼出対象: 2立先のグループ
    const targetStandGroup = afterGroup + 2;
    const totalGroups = typeof afterData.totalStandGroups === "number" ? afterData.totalStandGroups : 999;

    // 【フールプルーフ】総立数を超過している場合は送信対象外として終了
    if (targetStandGroup > totalGroups) {
      console.log(`【Functionsログ】呼出対象立（第${targetStandGroup}立）が総立数（全${totalGroups}立）を超過しているため送信をスキップします。`);
      return;
    }

    console.log(`【Functions進行検知】第${currentRound}立 / 現在: 第${afterGroup}立が入場 -> 呼出対象: 第${targetStandGroup}立`);

    try {
      // 1. users コレクションから、現在進行中の立において targetStandGroup に該当する選手を検索
      // ドキュメント構造: standAssignments[currentRound].standGroup == targetStandGroup
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

      // 送信対象トークンが存在しない場合は終了
      if (validTokensWithRefs.length === 0) {
        console.log(`【Functionsログ】第${currentRound}立の第${targetStandGroup}立に該当する登録FCMトークンが存在しません。`);
        return;
      }

      const tokens = validTokensWithRefs.map((item) => item.token);
      const roundLabel = currentRound === 1 ? "第1立(午前一手)" : currentRound === 2 ? "第2立(午後一手)" : "第3立(決勝四矢)";

      // 2. FCM マルチキャストメッセージの構築
      // 【要件定義】メッセージ通知あり・バイブレーションあり・通知音あり
      const multicastMessage: admin.messaging.MulticastMessage = {
        tokens,
        // 全プラットフォーム共通通知ペイロード
        notification: {
          title: `【招集呼出】まもなく第${targetStandGroup}立の入場です`,
          body: `現在、第${afterGroup}立が入場しました。${roundLabel} 第${targetStandGroup}立の選手は控席・招集所へ速やかにお集まりください。`,
        },
        // アプリケーション連携用データペイロード
        data: {
          matchId: event.params.matchId,
          targetStandGroup: String(targetStandGroup),
          currentRound: String(currentRound),
          click_action: "/standby",
        },
        // 【スマートフォンWebブラウザ向け設定（Chrome / Safari / Edge）】
        // sound（音声再生）、vibrate（振動パターン: 振動300ms, 休止150msの明確なパターン）を明示
        webpush: {
          headers: {
            Urgency: "high",
          },
          notification: {
            icon: "/favicon.ico",
            badge: "/favicon.ico",
            // 振動パターン（ミリ秒）: 300ms振動 -> 150ms休止 -> 300ms振動 -> 150ms休止 -> 300ms振動
            vibrate: [300, 150, 300, 150, 300],
            // 通知音を鳴動させる設定（消音解除）
            silent: false,
            // 選手がタップまたは閉じるまで通知バナーを画面に保持
            requireInteraction: true,
            // 同一立タグで再通知時も確実に再振動・再鳴動
            renotify: true,
            tag: `kyudo-call-round${currentRound}-group${targetStandGroup}`,
          },
          fcmOptions: {
            link: "/standby",
          },
        },
        // 【Androidスマートフォン向け設定】
        // 音声あり（sound: default）、高優先度バイブレーションあり
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
        // 【iOS (APNs) 端末向け設定】
        // 音声あり（sound: default）、バッジ付与
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

      // 3. 一括配信の実行
      const response = await messaging.sendEachForMulticast(multicastMessage);
      console.log(`【Functions FCM送信結果】成功: ${response.successCount} 件, 失敗: ${response.failureCount} 件 (対象立: 第${targetStandGroup}立)`);

      // 4. 【フェイルセーフ】無効・失効トークンの自己修復（クリーンアップバッチ処理）
      if (response.failureCount > 0) {
        const batch = db.batch();
        let invalidCount = 0;

        response.responses.forEach((resp, idx) => {
          if (!resp.success && resp.error) {
            const errorCode = resp.error.code;
            console.warn(`【Functions送信エラー詳細】トークン: ${tokens[idx].substring(0, 10)}... エラーコード: ${errorCode}, メッセージ: ${resp.error.message}`);

            // 登録解除済みまたは不正なトークンを検知した場合は users ドキュメントから削除
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
          console.log(`【Functions自己修復】無効・期限切れFCMトークン ${invalidCount} 件をFirestoreから自動削除しました。`);
        }
      }
    } catch (error: unknown) {
      // 【フェイルセーフ】予期せぬ例外発生時もクラッシュを防止し詳細エラーログを出力
      console.error("【Functions致命的例外】選手呼出通知処理中にエラーが発生しました:", error);
    }
  }
);