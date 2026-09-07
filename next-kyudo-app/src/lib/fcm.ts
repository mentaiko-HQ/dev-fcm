/**
 * 【FCM トークン発行および通知権限管理ロジック】
 * 
 * フールプルーフ設計:
 * - VAPIDキーの未設定検知、ブラウザの通知許可状態（granted, denied, default）に応じた適切な分岐制御。
 * 
 * フェイルセーフ設計:
 * - ユーザーが通知を拒否（denied）した場合や、Service Workerの登録に失敗した場合でも、
 *   例外をキャッチして呼び出し元へ null を返却し、システム全体の処理を継続可能にする。
 */

import { getToken, Messaging } from "firebase/messaging";
import { getMessagingInstance } from "@/lib/firebase";

export interface FCMTokenResult {
  token: string | null;
  status: "granted" | "denied" | "unsupported" | "error";
  errorMessage?: string;
}

/**
 * 通知許可を要求し、有効なFCMデバイストークンを取得する
 */
export async function requestFCMToken(): Promise<FCMTokenResult> {
  // 1. クライアント環境判定
  if (typeof window === "undefined" || !("Notification" in window)) {
    return { token: null, status: "unsupported", errorMessage: "このブラウザは通知に対応していません。" };
  }

  // 2. VAPID公開鍵の取得
  const vapidKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;
  if (!vapidKey) {
    console.error("【FCM設定エラー】NEXT_PUBLIC_FIREBASE_VAPID_KEY が設定されていません。");
    return { token: null, status: "error", errorMessage: "サーバーのVAPIDキー設定が不足しています。" };
  }

  try {
    // 3. 通知権限のリクエスト（フールプルーフ）
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      console.warn("【FCM通知拒否】ユーザーによって通知権限が拒否されました。");
      return { token: null, status: "denied", errorMessage: "通知の受信が許可されていません。" };
    }

    // 4. Messagingインスタンスの解決
    const messaging: Messaging | null = await getMessagingInstance();
    if (!messaging) {
      return { token: null, status: "unsupported", errorMessage: "Messaging機能の起動に失敗しました。" };
    }

    // 5. Service Worker の登録状況確認
    let serviceWorkerRegistration: ServiceWorkerRegistration | undefined;
    if ("serviceWorker" in navigator) {
      const swUrl = `/firebase-messaging-sw.js?projectId=${process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID}&messagingSenderId=${process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID}&apiKey=${process.env.NEXT_PUBLIC_FIREBASE_API_KEY}&appId=${process.env.NEXT_PUBLIC_FIREBASE_APP_ID}`;
      serviceWorkerRegistration = await navigator.serviceWorker.register(swUrl);
      await navigator.serviceWorker.ready;
    }

    // 6. トークンの取得
    const currentToken = await getToken(messaging, {
      vapidKey,
      serviceWorkerRegistration,
    });

    if (currentToken) {
      return { token: currentToken, status: "granted" };
    } else {
      return { token: null, status: "error", errorMessage: "登録可能なトークンが見つかりませんでした。" };
    }
  } catch (error: unknown) {
    console.error("【FCMトークン取得エラー】詳細ログ:", error);
    return {
      token: null,
      status: "error",
      errorMessage: error instanceof Error ? error.message : "トークン取得中に不明なエラーが発生しました。",
    };
  }
}