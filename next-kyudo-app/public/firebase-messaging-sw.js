// FCM バックグラウンドプッシュ受信用 サービスワーカー
importScripts(
  'https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js',
);
importScripts(
  'https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js',
);

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

// バックグラウンド通知受信ハンドラ
messaging.onBackgroundMessage((payload) => {
  console.log('【FCM SW】バックグラウンドメッセージを受信しました: ', payload);

  const notificationTitle = payload.notification
    ? payload.notification.title
    : '弓道大会運営システム';
  const notificationOptions = {
    body: payload.notification
      ? payload.notification.body
      : '新しい呼出通知があります。',
    icon: '/favicon.ico',
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});
