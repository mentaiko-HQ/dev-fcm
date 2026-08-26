import { getToken, onMessage, MessagePayload } from "firebase/messaging";
import { messaging, isFirebaseConfigured } from "./firebase";

const VAPID_KEY = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY || "";

/**
 * FCMトークンを安全に取得する関数
 * フールプルーフ / フェイルセーフ: 権限状態の検証、Service Workerアクティブ化待機、エラー時のフォールバック
 */
export async function requestFcmToken(): Promise<string | null> {
  try {
    // フールプルーフ: Firebase SDKの初期化状態を検証
    if (!isFirebaseConfigured || !messaging) {
      console.warn("【通知警告】Firebase設定が未完了のためFCMトークン取得をスキップします。");
      return null;
    }

    // フールプルーフ: ブラウザの通知機能およびService Workerサポート環境を検証
    if (
      typeof window === "undefined" ||
      !("Notification" in window) ||
      !("serviceWorker" in navigator)
    ) {
      console.warn("【通知警告】このブラウザはWebプッシュ通知またはService Workerをサポートしていません。");
      return null;
    }

    // フールプルーフ: 通知パーミッションの要求と検証
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      console.warn("【通知警告】通知の許可が得られませんでした。現在の権限:", permission);
      return null;
    }

    // サービスワーカーの登録
    await navigator.serviceWorker.register("/firebase-messaging-sw.js");

    // フェイルセーフ & フールプルーフ: Service Workerがアクティブになるまで待機
    const activeRegistration = await navigator.serviceWorker.ready;

    // フールプルーフ: VAPIDキーの検証
    if (!VAPID_KEY) {
      console.warn("【通知警告】NEXT_PUBLIC_FIREBASE_VAPID_KEY が設定されていません。Firebase ConsoleのCloud MessagingタブよりWeb Push 証明書キーを設定してください。");
    }

    const currentToken = await getToken(messaging, {
      vapidKey: VAPID_KEY || undefined,
      serviceWorkerRegistration: activeRegistration,
    });

    if (currentToken) {
      console.log("【FCM】トークン取得成功:", currentToken);
      return currentToken;
    } else {
      console.warn("【通知警告】トークンが生成されませんでした。Firebase ConsoleのWeb Push設定をご確認ください。");
      return null;
    }
  } catch (error: unknown) {
    const errorDetail =
      error instanceof Error
        ? { message: error.message, stack: error.stack }
        : String(error);

    console.error("【エラーログ】FCMトークンの取得処理中に例外が発生しました:", errorDetail);
    return null;
  }
}

/**
 * フォアグラウンド受信リスナーを設定する関数
 * フェイルセーフ: コールバック内での例外発生時も後続処理を阻害しない
 */
export function setupForegroundMessageListener(
  onMessageReceived: (payload: MessagePayload) => void
): () => void {
  if (!isFirebaseConfigured || !messaging) {
    return () => {};
  }

  try {
    const unsubscribe = onMessage(messaging, (payload) => {
      console.log("【FCM】フォアグラウンド通知を受信しました:", payload);
      try {
        onMessageReceived(payload);
      } catch (callbackError) {
        console.error("【エラーログ】通知コールバック実行中にエラーが発生しました:", callbackError);
      }
    });

    return unsubscribe;
  } catch (error) {
    console.error("【エラーログ】フォアグラウンドリスナーの設定に失敗しました:", error);
    return () => {};
  }
}