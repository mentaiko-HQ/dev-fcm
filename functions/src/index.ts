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
  currentStandGroup?: number;
  [key: string]: unknown;
}

interface EntryDocumentData {
  bibNumber?: number;
  name?: string;
  standGroup?: number;
  standOrder?: number;
  userId?: string;
  qualificationStatus?: "ACTIVE" | "ABSENT" | "WITHDRAWN" | "DISQUALIFIED";
  [key: string]: unknown;
}

interface UserDocumentData {
  fcmToken?: string;
  selectedEntryId?: string | null;
  [key: string]: unknown;
}

/**
 * 試合進行ドキュメント（matches/{matchId}）の更新を監視し、
 * 2つ前の立ちグループが開始された時点で対象の個人選手へFCM招集通知を自動送信するCloud Function (v2)
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

    const previousGroup: number = typeof beforeData?.currentStandGroup === "number" ? beforeData.currentStandGroup : 0;
    const currentGroup: number = typeof afterData?.currentStandGroup === "number" ? afterData.currentStandGroup : 0;

    // フールプルーフ: 立ちグループが進んでいない場合は通知を発報しない
    if (currentGroup <= previousGroup) {
      console.log(`【監視ログ】立ちグループの進行なし（前: ${previousGroup}, 今: ${currentGroup}）。処理を終了します。`);
      return;
    }

    // 弓道大会運用ルール: 2立前呼出（現在進行中の立ちグループ + 2）
    const targetGroupNumber: number = currentGroup + 2;
    console.log(`【進行更新検知】第${currentGroup}立グループ開始を検知。呼出対象: 第${targetGroupNumber}立グループ`);

    try {
      // 1. 呼出対象の立ちグループ（standGroup）に所属する個人選手エントリーを抽出
      const entriesSnapshot = await db
        .collection("entries")
        .where("standGroup", "==", targetGroupNumber)
        .get();

      if (entriesSnapshot.empty) {
        console.log(`【招集通知】第${targetGroupNumber}立グループに該当する個人選手は登録されていません。`);
        return;
      }

      // 2. 招集対象選手のステータスを CALLED（招集中）にバッチ更新（フェイルセーフ）
      const batch = db.batch();
      const targetUserIds: string[] = [];

      entriesSnapshot.forEach((entryDoc) => {
        const entryData = entryDoc.data() as EntryDocumentData;
        if (entryData.qualificationStatus === "ACTIVE" || entryData.qualificationStatus === "WITHDRAWN") {
          batch.update(entryDoc.ref, {
            progressStatus: "CALLED",
            updatedAt: Date.now(),
          });

          if (entryData.userId) {
            targetUserIds.push(entryData.userId);
          }
        }
      });

      // 現在行射中の立ちグループ（currentGroup）の選手ステータスを SHOOTING（行射中）に更新
      const shootingEntriesSnapshot = await db
        .collection("entries")
        .where("standGroup", "==", currentGroup)
        .get();

      shootingEntriesSnapshot.forEach((sDoc) => {
        batch.update(sDoc.ref, {
          progressStatus: "SHOOTING",
          updatedAt: Date.now(),
        });
      });

      await batch.commit();

      // 3. 個人選手のFCMトークンを収集
      const tokens: string[] = [];
      const userDocIds: string[] = [];

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
        console.log(`【招集通知】第${targetGroupNumber}立グループに紐付く有効なFCMトークンがありません。`);
        return;
      }

      console.log(`【通知送信開始】第${targetGroupNumber}立グループの ${finalTokens.length} 件のデバイスへFCM送信を実行します。`);

      const payload: admin.messaging.MulticastMessage = {
        tokens: finalTokens,
        notification: {
          title: "【第５回めんたいこ杯】招集通知",
          body: `現在 第${currentGroup}立グループ が行射中です。第${targetGroupNumber}立グループの選手は弓道場控席へ入場してください。`,
        },
        data: {
          standGroup: String(targetGroupNumber),
          matchId: event.params.matchId,
          click_action: "http://localhost:3000",
          soundEffect: "chime",
        },
        webpush: {
          headers: {
            Urgency: "high",
          },
          notification: {
            tag: `stand-group-${targetGroupNumber}`,
            requireInteraction: true,
            icon: "/favicon.ico",
            badge: "/favicon.ico",
            vibrate: [300, 100, 300, 100, 300],
            silent: false,
          },
        },
      };

      const response: admin.messaging.BatchResponse = await admin.messaging().sendEachForMulticast(payload);
      console.log(`【招集通知完了】第${targetGroupNumber}立グループ, 成功: ${response.successCount}件, 失敗: ${response.failureCount}件`);

      const staleTokenUpdates: Promise<admin.firestore.WriteResult>[] = [];
      response.responses.forEach((res: admin.messaging.SendResponse, idx: number) => {
        if (!res.success) {
          const errorCode = res.error?.code;
          console.error(`【エラーログ】FCMトークン送信失敗 (User: ${finalUserDocIds[idx]}, Error: ${errorCode}):`, res.error);

          if (
            errorCode === "messaging/invalid-registration-token" ||
            errorCode === "messaging/registration-token-not-registered"
          ) {
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
      console.error("【エラーログ】招集通知実行中に致命的なエラーが発生しました:", error);
    }
  }
);