import { getToken } from 'firebase/messaging';
import { messaging } from './firebase';

const VAPID_KEY = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY || '';

/**
 * FCMトークンを安全に取得する関数
 * フールプルーフ / フェイルセーフ: 権限状態の検証とエラー時の安全なフォールバック
 */
export async function requestFcmToken(): Promise<string | null> {
  try {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      console.warn('【通知警告】このブラウザはWeb通知をサポートしていません。');
      return null;
    }

    if (!messaging) {
      console.warn(
        '【通知警告】FCM Messagingインスタンスが初期化されていません。',
      );
      return null;
    }

    // 通知パーミッションの要求
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      console.warn(
        '【通知警告】通知の許可が得られませんでした。現在の権限:',
        permission,
      );
      return null;
    }

    // サービスワーカーの登録確認
    const registration = await navigator.serviceWorker.register(
      '/firebase-messaging-sw.js',
    );

    const currentToken = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: registration,
    });

    if (currentToken) {
      return currentToken;
    } else {
      console.warn('【通知警告】トークンが取得できませんでした。');
      return null;
    }
  } catch (error) {
    // フェイルセーフ: 例外発生時もアプリ全体をクラッシュさせずにnullを返却
    console.error(
      '【エラーログ】FCMトークンの取得処理中に例外が発生しました:',
      error,
    );
    return null;
  }
}
