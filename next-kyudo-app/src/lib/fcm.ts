/**
 * 【FCM (Firebase Cloud Messaging) クライアントロジック】
 * 役割:
 * - ブラウザのPush通知対応確認およびFCMトークンの取得。
 *
 * フェイルセーフ設計:
 * - isSupported() でブラウザ対応を事前確認し、非対応ブラウザ（iOSの古いSafari等）でのクラッシュを防止。
 * - Service Workerの登録時に、.env.local の Firebase 設定値をURLクエリパラメータとして安全に引き渡す。
 */

import { getMessaging, getToken, isSupported } from 'firebase/messaging';
import { app } from '@/lib/firebase';

export async function requestFcmToken(): Promise<string | null> {
  try {
    const supported = await isSupported();
    if (!supported) {
      console.warn('【FCM】このブラウザはPush通知をサポートしていません。');
      return null;
    }

    const messaging = getMessaging(app);
    const vapidKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;

    if (!vapidKey) {
      throw new Error('VAPIDキーが環境変数に設定されていません。');
    }

    // フェイルセーフ: 既存の Service Worker (URLクエリ渡し対応版) を明示的に登録
    const swUrl = `/firebase-messaging-sw.js?apiKey=${process.env.NEXT_PUBLIC_FIREBASE_API_KEY}&projectId=${process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID}&messagingSenderId=${process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID}&appId=${process.env.NEXT_PUBLIC_FIREBASE_APP_ID}`;
    const registration = await navigator.serviceWorker.register(swUrl);

    // トークン取得（権限が未付与の場合はブラウザの許可ダイアログが表示される）
    const currentToken = await getToken(messaging, {
      vapidKey,
      serviceWorkerRegistration: registration,
    });

    if (currentToken) {
      return currentToken;
    } else {
      console.warn(
        '【FCM】トークンを取得できませんでした。通知権限が拒否されています。',
      );
      return null;
    }
  } catch (error) {
    console.error('【FCM】トークン取得エラー:', error);
    throw error;
  }
}
