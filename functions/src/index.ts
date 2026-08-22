import {
  onDocumentWritten,
  FirestoreEvent,
  Change,
} from 'firebase-functions/v2/firestore';
import { DocumentSnapshot } from 'firebase-admin/firestore';
import * as admin from 'firebase-admin';

// フェイルセーフ: Firebase Admin SDKの多重初期化を防止し、初期化エラー時はログを出力
if (admin.apps.length === 0) {
  try {
    admin.initializeApp();
  } catch (initError: unknown) {
    console.error('【エラーログ】Firebase Admin SDK初期化失敗:', initError);
  }
}

const db = admin.firestore();

// 試合進行ドキュメントの型定義（フールプルーフ: 想定外構造のアクセスを防止）
interface MatchDocumentData {
  currentStandNumber?: number;
  [key: string]: unknown;
}

// チームドキュメントの型定義
interface TeamDocumentData {
  name?: string;
  standNumber?: number;
  [key: string]: unknown;
}

// ユーザードキュメントの型定義
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
  'matches/{matchId}',
  async (
    event: FirestoreEvent<
      Change<DocumentSnapshot> | undefined,
      { matchId: string }
    >,
  ) => {
    // フールプルーフ: ドキュメントが存在しない（削除時など）は処理を中断
    if (!event.data?.after || !event.data.after.exists) {
      console.log(
        '【監視ログ】ドキュメント削除イベントまたはデータ不在のため処理をスキップします。',
      );
      return;
    }

    const beforeData = event.data.before?.data() as
      | MatchDocumentData
      | undefined;
    const afterData = event.data.after.data() as MatchDocumentData | undefined;

    const previousStand: number =
      typeof beforeData?.currentStandNumber === 'number'
        ? beforeData.currentStandNumber
        : 0;
    const currentStand: number =
      typeof afterData?.currentStandNumber === 'number'
        ? afterData.currentStandNumber
        : 0;

    // フールプルーフ: 進行立番号が進んでいない場合（スコア入力等による更新）は通知トリガーを行わない
    if (currentStand <= previousStand) {
      console.log(
        `【監視ログ】立番号の進行なし（前: ${previousStand}, 今: ${currentStand}）。処理を終了します。`,
      );
      return;
    }

    // 業務ロジック: 2立後の立番号を算出（例: 第1立開始時は第3立を招集）
    const targetStandNumber: number = currentStand + 2;
    console.log(
      `【進行更新】第${currentStand}立開始を検知。呼出対象: 第${targetStandNumber}立`,
    );

    try {
      // 呼出対象となる立のチームをFirestoreから取得
      const teamsSnapshot = await db
        .collection('teams')
        .where('standNumber', '==', targetStandNumber)
        .get();

      // フールプルーフ: 該当する立のチームが存在しない場合は早期終了
      if (teamsSnapshot.empty) {
        console.log(
          `【招集通知】第${targetStandNumber}立に該当するチームは登録されていません。`,
        );
        return;
      }

      for (const teamDoc of teamsSnapshot.docs) {
        const teamData = teamDoc.data() as TeamDocumentData;
        const teamId: string = teamDoc.id;
        const teamName: string =
          typeof teamData.name === 'string'
            ? teamData.name
            : `第${targetStandNumber}立`;

        // 該当チームを選択している全ユーザーのFCMトークンを取得
        const usersSnapshot = await db
          .collection('users')
          .where('selectedTeamId', '==', teamId)
          .get();

        const tokens: string[] = [];
        usersSnapshot.forEach(
          (userDoc: admin.firestore.QueryDocumentSnapshot) => {
            const userData = userDoc.data() as UserDocumentData;
            // フールプルーフ: トークンが存在し、かつ空文字でないことを確認
            if (
              userData.fcmToken &&
              typeof userData.fcmToken === 'string' &&
              userData.fcmToken.trim().length > 0
            ) {
              tokens.push(userData.fcmToken.trim());
            }
          },
        );

        // フェイルセーフ: 通知対象トークンが0件の場合はスキップして次へ
        if (tokens.length === 0) {
          console.log(
            `【招集通知】チーム「${teamName}」(ID: ${teamId}) に紐付く有効なFCMトークンがありません。`,
          );
          continue;
        }

        // FCMマルチキャストメッセージの組み立て
        const payload: admin.messaging.MulticastMessage = {
          tokens: tokens,
          notification: {
            title: '【招集通知】まもなく出番です',
            body: `現在 第${currentStand}立 が進行中です。${teamName} は弓道場控席へ入場してください。`,
          },
          data: {
            standNumber: String(targetStandNumber),
            teamId: teamId,
            matchId: event.params.matchId,
          },
        };

        // 一括プッシュ通知送信
        const response: admin.messaging.BatchResponse = await admin
          .messaging()
          .sendEachForMulticast(payload);
        console.log(
          `【招集通知完了】チーム: ${teamName}, 成功: ${response.successCount}件, 失敗: ${response.failureCount}件`,
        );

        // フェイルセーフ: 送信失敗したトークンの検知とログ出力
        response.responses.forEach(
          (res: admin.messaging.SendResponse, idx: number) => {
            if (!res.success) {
              console.error(
                `【エラーログ】FCMトークン送信失敗 (Token: ${tokens[idx]}):`,
                res.error,
              );
            }
          },
        );
      }
    } catch (error: unknown) {
      // フェイルセーフ: 例外発生時もFunction全体をクラッシュさせずにログへ記録
      console.error(
        '【エラーログ】招集通知の実行中に致命的なエラーが発生しました:',
        error,
      );
    }
  },
);
