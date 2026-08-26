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

interface TeamDocumentData {
  name?: string;
  standNumber?: number;
  [key: string]: unknown;
}

interface UserDocumentData {
  fcmToken?: string;
  selectedTeamId?: string;
  [key: string]: unknown;
}

/**
 * 試合進行ドキュメント（matches/{matchId}）の更新を監視し、
 * 2つ前の立が開始された時点で対象チームへFCM招集プッシュ通知を自動送信するCloud Function (v2)
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
      // 呼出対象立に該当するチームを検索
      const teamsSnapshot = await db
        .collection("teams")
        .where("standNumber", "==", targetStandNumber)
        .get();

      if (teamsSnapshot.empty) {
        console.log(`【招集通知】第${targetStandNumber}立に該当するチームは登録されていません。`);
        return;
      }

      for (const teamDoc of teamsSnapshot.docs) {
        const teamData = teamDoc.data() as TeamDocumentData;
        const teamId: string = teamDoc.id;
        const teamName: string = typeof teamData.name === "string" ? teamData.name : `第${targetStandNumber}立`;

        // 該当チームを選択しているユーザー（選手・付添者の登録端末）を検索
        const usersSnapshot = await db
          .collection("users")
          .where("selectedTeamId", "==", teamId)
          .get();

        const tokens: string[] = [];
        const userDocIds: string[] = [];

        usersSnapshot.forEach((userDoc: admin.firestore.QueryDocumentSnapshot) => {
          const userData = userDoc.data() as UserDocumentData;
          if (userData.fcmToken && typeof userData.fcmToken === "string" && userData.fcmToken.trim().length > 0) {
            tokens.push(userData.fcmToken.trim());
            userDocIds.push(userDoc.id);
          }
        });

        if (tokens.length === 0) {
          console.log(`【招集通知】チーム「${teamName}」(ID: ${teamId}) に紐付く有効なFCMトークンがありません。端末登録状況を確認してください。`);
          continue;
        }

        console.log(`【通知送信開始】チーム「${teamName}」の ${tokens.length} 件のデバイスへFCM送信を実行します。`);

        // マルチキャスト通知ペイロードの構築
        const payload: admin.messaging.MulticastMessage = {
          tokens: tokens,
          notification: {
            title: "【招集通知】まもなく出番です",
            body: `現在 第${currentStand}立 が進行中です。${teamName} は弓道場控席へ入場してください。`,
          },
          data: {
            standNumber: String(targetStandNumber),
            teamId: teamId,
            matchId: event.params.matchId,
            click_action: "http://localhost:3000",
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
            },
          },
        };

        const response: admin.messaging.BatchResponse = await admin.messaging().sendEachForMulticast(payload);
        console.log(`【招集通知完了】チーム: ${teamName}, 成功: ${response.successCount}件, 失敗: ${response.failureCount}件`);

        // フェイルセーフ: 無効となった古いトークンのクリーンアップ処理（デッドレター対策）
        const staleTokenUpdates: Promise<admin.firestore.WriteResult>[] = [];
        response.responses.forEach((res: admin.messaging.SendResponse, idx: number) => {
          if (!res.success) {
            const errorCode = res.error?.code;
            console.error(`【エラーログ】FCMトークン送信失敗 (User: ${userDocIds[idx]}, Error: ${errorCode}):`, res.error);

            if (
              errorCode === "messaging/invalid-registration-token" ||
              errorCode === "messaging/registration-token-not-registered"
            ) {
              console.log(`【トークン削除】無効なトークンをユーザー ${userDocIds[idx]} から削除します。`);
              staleTokenUpdates.push(
                db.collection("users").doc(userDocIds[idx]).update({
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
      }
    } catch (error: unknown) {
      console.error("【エラーログ】招集通知の実行中に致命的なエラーが発生しました:", error);
    }
  }
);