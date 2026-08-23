// Firebase Web SDK v9 互換スクリプト（バックグラウンド通知ハンドラ）
importScripts("https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js");

// フェイルセーフ: インストール時に待機せず即時アクティブ化（No active Service Worker エラー防止）
self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(clients.claim());
});

// フェイルセーフ: サービスワーカー内での初期化エラーを安全に捕捉
try {
  // 環境変数ではなくクライアント公開設定（Firebase Console上のWebアプリ構成値）
  const firebaseConfig = {
    apiKey: "AIzaSyYourActualApiKeyHere",
    authDomain: "kyudoapp-dev-fcm.firebaseapp.com",
    projectId: "kyudoapp-dev-fcm",
    storageBucket: "kyudoapp-dev-fcm.appspot.com",
    messagingSenderId: "123456789012",
    appId: "1:123456789012:web:abcdef123456"
  };

  firebase.initializeApp(firebaseConfig);
  const messaging = firebase.messaging();

  // バックグラウンド受信時の通知表示ハンドラ
  messaging.onBackgroundMessage((payload) => {
    console.log("【FCM SW】バックグラウンド通知を受信しました:", payload);

    const notificationTitle = payload.notification?.title || "【弓道大会運営】招集通知";
    const notificationOptions = {
      body: payload.notification?.body || "出番が近づいています。控席へ入場してください。",
      icon: "/favicon.ico",
      badge: "/favicon.ico",
      tag: payload.data?.standNumber ? `stand-${payload.data.standNumber}` : "kyudo-stand-call",
      data: payload.data,
      vibrate: [200, 100, 200, 100, 200],
      requireInteraction: true // 選手が見落とさないようユーザー操作まで通知を維持（フールプルーフ）
    };

    self.registration.showNotification(notificationTitle, notificationOptions);
  });
} catch (error) {
  console.error("【エラーログ】サービスワーカーの初期化または通知処理に失敗しました:", error);
}

// 通知クリック時のフォーカス制御
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url && "focus" in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow("/");
      }
    })
  );
});