import { onDocumentWritten, FirestoreEvent, Change } from "firebase-functions/v2/firestore";
import { DocumentSnapshot } from "firebase-admin/firestore";
import * as admin from "firebase-admin";

// フェイルセーフ: Firebase Admin SDKの多重初期化を防止し、初期化エラー時は構造化ログを出力
if (admin.apps.length === 0) {
  try {
    admin.initializeApp();
  } catch (initError: unknown) {
    console.error("【エラーログ】Firebase Admin SDK初期化失敗:", initError);
  }
}

const db = admin.firestore();

interface MatchDocumentData {
  currentStandNumber?: number;
  [key: string]: unknown;
}

interface EntryDocumentData {
  entryType?: "TEAM" | "INDIVIDUAL";
  progressStatus?: "WAITING" | "CALLED" | "SHOOTING" | "COMPLETED";
  qualificationStatus?: "ACTIVE" | "ABSENT" | "WITHDRAWN" | "DISQUALIFIED";
  standNumber?: number;
  teamId?: string | null;
  teamName?: string;
  playerName?: string;
  userId?: string;
  [key: string]: unknown;
}

interface UserDocumentData {
  fcmToken?: string;
  selectedTeamId?: string | null;
  selectedEntryId?: string | null;
  [key: string]: unknown;
}

/**
 * 試合進行ドキュメント（matches/{matchId}）の更新を監視し、
 * 2つ前の立が開始された時点で対象の団体・個人選手へFCM招集通知を自動送信するCloud Function (v2)
 */
export const onMatchProgressUpdated = onDocumentWritten(
  {
    document: "matches/{matchId}",
    region: "asia-northeast1",
    maxInstances: 10,
    retry: false, // フールプルーフ: 二重通知事故防止のため自動リトライは無効化
  },
  async (event: FirestoreEvent<Change<DocumentSnapshot> | undefined, { matchId: string }>) => {
    if (!event.data?.after || !event.data.after.exists) {
      console.log("【監視ログ】ドキュメント削除イベントまたはデータ不在のため処理をスキップします。");
      return;
    }

    const beforeData = event.data.before?.data() as MatchDocumentData | undefined;
    const afterData = event.data.after.data() as MatchDocumentData | undefined;

    const previousStand: number = typeof beforeData?.currentStandNumber === "number" ? beforeData.currentStandNumber : 0;
    const currentStand: number = typeof afterData?.currentStandNumber === "number" ? afterData.currentStandNumber : 0;

    // フールプルーフ: 立が進んでいない場合（差戻しや同一番号の更新）は通知を発報しない
    if (currentStand <= previousStand) {
      console.log(`【監視ログ】立番号の進行なし（前: ${previousStand}, 今: ${currentStand}）。処理を終了します。`);
      return;
    }

    // 弓道大会運用ルール: 2立前呼出（現在進行中の立 + 2）
    const targetStandNumber: number = currentStand + 2;
    console.log(`【進行更新検知】第${currentStand}立開始を検知。呼出対象: 第${targetStandNumber}立`);

    try {
      // 1. 呼出対象立に所属する選手エントリー（団体・個人混在）を抽出
      const entriesSnapshot = await db
        .collection("entries")
        .where("standNumber", "==", targetStandNumber)
        .get();

      if (entriesSnapshot.empty) {
        console.log(`【招集通知】第${targetStandNumber}立に該当する選手エントリーは登録されていません。`);
        return;
      }

      // 2. 招集対象立の選手ステータスを CALLED（招集中）にバッチ更新（フェイルセーフ）
      const batch = db.batch();
      const targetTeamIds = new Set<string>();
      const targetUserIds = new Set<string>();

      entriesSnapshot.forEach((entryDoc) => {
        const entryData = entryDoc.data() as EntryDocumentData;
        // 欠席・失格以外の選手のみ招集更新対象
        if (entryData.qualificationStatus === "ACTIVE" || entryData.qualificationStatus === "WITHDRAWN") {
          batch.update(entryDoc.ref, {
            progressStatus: "CALLED",
            updatedAt: Date.now(),
          });

          if (entryData.entryType === "TEAM" && entryData.teamId) {
            targetTeamIds.add(entryData.teamId);
          } else if (entryData.userId) {
            targetUserIds.add(entryData.userId);
          }
        }
      });

      // 現在行射中の立（currentStand）の選手ステータスを SHOOTING（行射中）に更新
      const shootingEntriesSnapshot = await db
        .collection("entries")
        .where("standNumber", "==", currentStand)
        .get();

      shootingEntriesSnapshot.forEach((sDoc) => {
        batch.update(sDoc.ref, {
          progressStatus: "SHOOTING",
          updatedAt: Date.now(),
        });
      });

      await batch.commit();

      // 3. 宛先トークンの収集（団体所属端末 ＋ 個人選手端末のマルチキャスト宛先解決）
      const tokens: string[] = [];
      const userDocIds: string[] = [];

      // A. 団体チーム登録端末のFCMトークン取得
      for (const teamId of targetTeamIds) {
        const teamUsersSnapshot = await db
          .collection("users")
          .where("selectedTeamId", "==", teamId)
          .get();

        teamUsersSnapshot.forEach((uDoc) => {
          const uData = uDoc.data() as UserDocumentData;
          if (uData.fcmToken && uData.fcmToken.trim().length > 0) {
            tokens.push(uData.fcmToken.trim());
            userDocIds.push(uDoc.id);
          }
        });
      }

      // B. 個人参加選手登録端末のFCMトークン取得
      for (const userId of targetUserIds) {
        const userDoc = await db.collection("users").doc(userId).get();
        if (userDoc.exists) {
          const uData = userDoc.data() as UserDocumentData;
          if (uData.fcmToken && uData.fcmToken.trim().length > 0) {
            tokens.push(uData.fcmToken.trim());
            userDocIds.push(userDoc.id);
          }
        }
      }

      // 重複トークンの排除（フールプルーフ）
      const uniqueTokenMap = new Map<string, string>();
      tokens.forEach((t, idx) => {
        uniqueTokenMap.set(t, userDocIds[idx]);
      });

      const finalTokens = Array.from(uniqueTokenMap.keys());
      const finalUserDocIds = Array.from(uniqueTokenMap.values());

      if (finalTokens.length === 0) {
        console.log(`【招集通知】第${targetStandNumber}立に紐付く有効なFCMトークンがありません。端末登録状況を確認してください。`);
        return;
      }

      console.log(`【通知送信開始】第${targetStandNumber}立（団体/個人混成）の ${finalTokens.length} 件のデバイスへFCM送信を実行します。`);

      // マルチキャスト通知ペイロードの構築
      const payload: admin.messaging.MulticastMessage = {
        tokens: finalTokens,
        notification: {
          title: "【招集通知】まもなく出番です",
          body: `現在 第${currentStand}立 が進行中です。第${targetStandNumber}立（団体・個人選手）は弓道場控席へ入場してください。`,
        },
        data: {
          standNumber: String(targetStandNumber),
          matchId: event.params.matchId,
          click_action: "http://localhost:3000",
          soundEffect: "chime",
        },
        webpush: {
          headers: {
            Urgency: "high",
          },
          notification: {
            tag: `stand-${targetStandNumber}`,
            requireInteraction: true,
            icon: "/favicon.ico",
            badge: "/favicon.ico",
            vibrate: [300, 100, 300, 100, 300],
            silent: false,
          },
        },
      };

      const response: admin.messaging.BatchResponse = await admin.messaging().sendEachForMulticast(payload);
      console.log(`【招集通知完了】第${targetStandNumber}立, 成功: ${response.successCount}件, 失敗: ${response.failureCount}件`);

      // フェイルセーフ: 無効となった古いトークンのクリーンアップ処理（デッドレター対策）
      const staleTokenUpdates: Promise<admin.firestore.WriteResult>[] = [];
      response.responses.forEach((res: admin.messaging.SendResponse, idx: number) => {
        if (!res.success) {
          const errorCode = res.error?.code;
          console.error(`【エラーログ】FCMトークン送信失敗 (User: ${finalUserDocIds[idx]}, Error: ${errorCode}):`, res.error);

          if (
            errorCode === "messaging/invalid-registration-token" ||
            errorCode === "messaging/registration-token-not-registered"
          ) {
            console.log(`【トークン削除】無効なトークンをユーザー ${finalUserDocIds[idx]} から削除します。`);
            staleTokenUpdates.push(
              db.collection("users").doc(finalUserDocIds[idx]).update({
                fcmToken: admin.firestore.FieldValue.delete(),
                updatedAt: Date.now(),
              })
            );
          }
        }
      });

      if (staleTokenUpdates.length > 0) {
        await Promise.all(staleTokenUpdates);
      }
    } catch (error: unknown) {
      console.error("【エラーログ】招集通知の実行中に致命的なエラーが発生しました:", error);
    }
  }
);