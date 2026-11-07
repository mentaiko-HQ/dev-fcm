/**
 * 【FCM (Firebase Cloud Messaging) トークン取得・フォアグラウンド通知管理ライブラリ】
 *
 * 役割:
 * 1. クライアント端末（スマートフォン・PC）が Web Push 通知に対応しているかを安全に判定。
 * 2. ブラウザの通知許可（Notification.requestPermission）を取得し、Service Worker を介して FCM トークンを発行。
 * 3. アプリ画面を開いている状態（フォアグラウンド）でのプッシュ通知受信リスナーを提供。
 *
 * フールプルーフ設計（事故前・対人間）:
 * - 通知がブラウザ設定で拒否（denied）されている場合、具体的な設定解除手順を含むステータスメッセージを返却。
 * - iOS Safari（非PWAモード）など Web Push 非対応環境では、例外を投げずに「画面内リアルタイム連動モード」へ誘導。
 *
 * フェイルセーフ設計（事故後・対故障）:
 * - VAPIDキー未設定やネットワーク瞬断時でもアプリ全体をクラッシュさせず、token: null と理由コードを安全に返却。
 * - firebase.ts から default export ではなく named export (app) を正しくインポートするよう修正。
 */

import {
  getMessaging,
  getToken,
  onMessage,
  isSupported,
  MessagePayload,
} from 'firebase/messaging';
import { app, isFirebaseConfigured } from '@/lib/firebase';

export interface FcmTokenResult {
  token: string | null;
  permissionStatus: NotificationPermission | 'UNSUPPORTED';
  errorMessage: string | null;
}

/**
 * 端末のFCMトークンを取得する非同期関数
 */
export async function requestFcmTokenSafely(): Promise<FcmTokenResult> {
  if (typeof window === 'undefined') {
    return {
      token: null,
      permissionStatus: 'UNSUPPORTED',
      errorMessage: 'サーバーサイド環境では実行できません。',
    };
  }

  if (!isFirebaseConfigured || !app) {
    return {
      token: null,
      permissionStatus: 'UNSUPPORTED',
      errorMessage: 'Firebase設定が完了していません。',
    };
  }

  try {
    // 1. ブラウザが Firebase Messaging (Push API / Service Worker) に対応しているか確認
    const supported = await isSupported().catch(() => false);
    if (!supported || !('Notification' in window)) {
      return {
        token: null,
        permissionStatus: 'UNSUPPORTED',
        errorMessage:
          'お使いのブラウザはWebプッシュ通知に対応していません（iPhoneの場合は「ホーム画面に追加」から開くと通知が有効になります）。画面内のリアルタイム招集表示はそのままご利用いただけます。',
      };
    }

    // 2. 通知権限の確認と要求
    let permission = Notification.permission;
    if (permission === 'default') {
      permission = await Notification.requestPermission();
    }

    if (permission !== 'granted') {
      return {
        token: null,
        permissionStatus: permission,
        errorMessage:
          'ブラウザの通知権限がブロックされています。アドレスバー左側の設定アイコンから「通知」を「許可」に変更してください（画面内のリアルタイム表示は有効です）。',
      };
    }

    // 3. Service Worker の登録確認
    let swRegistration: ServiceWorkerRegistration | undefined = undefined;
    if ('serviceWorker' in navigator) {
      try {
        swRegistration = await navigator.serviceWorker.register(
          '/firebase-messaging-sw.js',
        );
      } catch (swErr) {
        console.warn('【FCM】Service Worker登録警告:', swErr);
      }
    }

    // 4. FCM トークンの取得
    const messaging = getMessaging(app);
    const vapidKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;

    const currentToken = await getToken(messaging, {
      vapidKey: vapidKey || undefined,
      serviceWorkerRegistration: swRegistration,
    });

    if (currentToken) {
      return {
        token: currentToken,
        permissionStatus: 'granted',
        errorMessage: null,
      };
    } else {
      return {
        token: null,
        permissionStatus: permission,
        errorMessage: 'FCMトークンの発行結果が空でした。',
      };
    }
  } catch (err: unknown) {
    console.error('【FCMトークン取得例外】:', err);
    return {
      token: null,
      permissionStatus:
        typeof window !== 'undefined' && 'Notification' in window
          ? Notification.permission
          : 'UNSUPPORTED',
      errorMessage:
        'プッシュ通知トークンの取得中に通信エラーが発生しましたが、画面内のリアルタイム自動更新で招集状況を確認できます。',
    };
  }
}

/**
 * フォアグラウンドでFCMメッセージを受信した際のコールバックを登録する
 */
export async function subscribeForegroundMessages(
  onReceive: (payload: MessagePayload) => void,
): Promise<(() => void) | null> {
  if (typeof window === 'undefined' || !isFirebaseConfigured || !app) {
    return null;
  }

  try {
    const supported = await isSupported().catch(() => false);
    if (!supported) return null;

    const messaging = getMessaging(app);
    const unsubscribe = onMessage(messaging, (payload) => {
      console.log('【FCMフォアグラウンド受信】:', payload);
      onReceive(payload);
    });
    return unsubscribe;
  } catch (err) {
    console.warn('【FCMフォアグラウンド監視設定スキップ】:', err);
    return null;
  }
}
