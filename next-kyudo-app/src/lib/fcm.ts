/**
 * 【Firebase Cloud Messaging (FCM) クライアントトークン取得モジュール】
 *
 * 役割:
 * - ブラウザの通知パーミッション（Notification API）の要求および状態検証。
 * - Service Worker (firebase-messaging-sw.js) の稼働確認および登録。
 * - Firebase SDK (getToken) を経由したデバイストークンの発行・取得。
 * - `requestNotificationPermissionAndGetToken` および後方互換用 `requestFcmToken` の両方をエクスポート。
 *
 * フールプルーフ設計（事故前・対人間）:
 * - SSR（サーバーサイドレンダリング）環境下での window / navigator 参照による例外発生を入口で遮断。
 * - 通知権限が「denied（拒否）」状態の場合、不要なトークン要求処理を即座に中断し、明示的なエラーメッセージを返却。
 * - VAPIDキー未設定時（環境変数不備）にわかりやすいエラーメッセージを返却し、原因特定を迅速化。
 *
 * フェイルセーフ設計（事故後・対故障）:
 * - Service Worker の登録失敗やプッシュ通知非対応ブラウザ（iOS非PWA、特定アプリ内ブラウザ）でも
 *   例外を上位へスローせず、構造化された戻り値 `{ token: null, error: '...' }` として安全に縮退。
 * - ネットワーク切断時でもアプリのクラッシュを防止。
 */

import { getMessaging, getToken, isSupported } from 'firebase/messaging';
import { app, isFirebaseConfigured } from '@/lib/firebase';

export interface FcmTokenResult {
  token: string | null;
  error?: string | null;
}

/**
 * 【メイン関数】通知パーミッションの要求およびFCMトークンの取得
 *
 * @returns {Promise<FcmTokenResult>} 発行されたトークン文字列またはエラー詳細
 */
export async function requestNotificationPermissionAndGetToken(): Promise<FcmTokenResult> {
  // 1. SSR環境およびFirebase未初期化の早期遮断（フールプルーフ）
  if (
    typeof window === 'undefined' ||
    !('Notification' in window) ||
    !('serviceWorker' in navigator)
  ) {
    return {
      token: null,
      error: 'ご利用のブラウザはWebプッシュ通知に対応していません。',
    };
  }

  if (!isFirebaseConfigured || !app) {
    return {
      token: null,
      error: 'Firebaseが初期化されていません。環境変数設定を確認してください。',
    };
  }

  // 2. ブラウザがFCMをサポートしているか検証
  try {
    const supported = await isSupported();
    if (!supported) {
      return {
        token: null,
        error:
          'この端末・ブラウザ環境ではFirebase Messagingがサポートされていません。',
      };
    }
  } catch (supportErr) {
    console.warn('【FCM isSupported判定例外】:', supportErr);
    return {
      token: null,
      error: 'プッシュ通知の動作要件を満たしていません。',
    };
  }

  // 3. 通知権限（Permission）の確認・要求
  let permission: NotificationPermission = Notification.permission;
  if (permission === 'default') {
    try {
      permission = await Notification.requestPermission();
    } catch (permErr) {
      console.warn('【Notification.requestPermission例外】:', permErr);
      return {
        token: null,
        error: '通知許可ダイアログの表示に失敗しました。',
      };
    }
  }

  if (permission !== 'granted') {
    return {
      token: null,
      error:
        permission === 'denied'
          ? '通知がブロックされています。ブラウザの設定から通知を許可してください。'
          : '通知の許可がキャンセルされました。',
    };
  }

  // 4. VAPIDキーの取得検証
  const vapidKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;
  if (!vapidKey) {
    console.error(
      '【FCM環境変数エラー】NEXT_PUBLIC_FIREBASE_VAPID_KEY が未定義です。',
    );
    return {
      token: null,
      error:
        'プッシュ通知認証キー(VAPID)が設定されていません。大会運営本部にお問い合わせください。',
    };
  }

  // 5. Service Worker の準備およびトークン発行
  try {
    // 既存の登録済みService Workerを確認
    let swRegistration = await navigator.serviceWorker.getRegistration(
      '/firebase-messaging-sw.js',
    );
    if (!swRegistration) {
      swRegistration = await navigator.serviceWorker.register(
        '/firebase-messaging-sw.js',
        {
          scope: '/',
        },
      );
    }

    // サービスワーカーのアクティブ化を待機
    await navigator.serviceWorker.ready;

    const messaging = getMessaging(app);
    const currentToken = await getToken(messaging, {
      vapidKey,
      serviceWorkerRegistration: swRegistration,
    });

    if (currentToken) {
      console.info(
        '【FCMトークン取得成功】トークンプレビュー:',
        currentToken.substring(0, 15) + '...',
      );
      return {
        token: currentToken,
        error: null,
      };
    } else {
      return {
        token: null,
        error:
          'トークンが生成されませんでした。端末のネットワーク接続を確認してください。',
      };
    }
  } catch (tokenError: unknown) {
    console.error('【FCM getToken例外】:', tokenError);
    const errorMsg =
      tokenError instanceof Error ? tokenError.message : String(tokenError);

    // 代表的なエラーのハンドリング
    if (
      errorMsg.includes('permission-blocked') ||
      errorMsg.includes('Notifications are blocked')
    ) {
      return {
        token: null,
        error:
          '通知がブロックされています。ブラウザの鍵アイコンから通知を許可してください。',
      };
    }

    return {
      token: null,
      error: `通知トークン取得に失敗しました (${errorMsg})`,
    };
  }
}

/**
 * 【後方互換用エイリアス関数】requestFcmToken
 * 既存コンポーネントが単一のトークン文字列（または null）を期待している場合に対応。
 *
 * @returns {Promise<string | null>}
 */
export async function requestFcmToken(): Promise<string | null> {
  const result = await requestNotificationPermissionAndGetToken();
  return result.token;
}
