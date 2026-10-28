/**
 * 【FCM サービスワーカー (バックグラウンド通知受信)】
 * 役割:
 * - ブラウザを閉じている、または別のタブを開いている状態でもPush通知を受信する。
 *
 * フールプルーフ設計:
 * - Next.js の環境変数 (process.env) は Service Worker 内で参照できないため、
 *   意図的な未定義エラーを防ぐべく、公開鍵情報（Firebase Config）を直接記述します。
 *   ※ 運用時、下記の firebaseConfig は .env.local と同じ値に置き換えてください。
 */

importScripts(
  'https://www.gstatic.com/firebasejs/11.4.0/firebase-app-compat.js',
);
importScripts(
  'https://www.gstatic.com/firebasejs/11.4.0/firebase-messaging-compat.js',
);

// TODO: 本番デプロイ時に .env.local の値で書き換える
const firebaseConfig = {
  apiKey: 'YOUR_API_KEY',
  authDomain: 'YOUR_AUTH_DOMAIN',
  projectId: 'YOUR_PROJECT_ID',
  storageBucket: 'YOUR_STORAGE_BUCKET',
  messagingSenderId: 'YOUR_MESSAGING_SENDER_ID',
  appId: 'YOUR_APP_ID',
};

firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

// バックグラウンドでの通知受け取り処理
messaging.onBackgroundMessage(function (payload) {
  console.log(
    '[firebase-messaging-sw.js] バックグラウンド通知を受信しました:',
    payload,
  );

  const notificationTitle = payload.notification.title || '進行お知らせ';
  const notificationOptions = {
    body: payload.notification.body,
    icon: '/favicon.ico',
    requireInteraction: true, // 通知をユーザーがタップするまで表示し続ける
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});
