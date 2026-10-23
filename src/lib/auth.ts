/**
 * 【運営端末 認証セッション管理モジュール（ID・パスワード認証）】
 *
 * 役割:
 * - Firebase Authentication によるメール・パスワード認証（signInWithEmailAndPassword）の実行。
 * - セッション状態の監視（onAuthStateChanged）およびログアウト処理（signOut）。
 * - 運営者カスタムクレーム（admin: true）の検証による認可判定。
 *
 * フールプルーフ設計（操作ミス・不正入力の入口遮断）:
 * - メールアドレスおよびパスワードの空文字・形式バリデーション。
 * - Firebase Auth エラーコード（auth/user-not-found, auth/wrong-password等）の日本語エラーメッセージ変換。
 * - 非匿名かつ運営者権限（カスタムクレーム admin === true または認証済み正規ユーザー）の多層検証。
 *
 * フェイルセーフ設計（障害時の安全縮退）:
 * - サーバーサイド（SSR）環境下での Auth API 呼び出しを安全に遮断。
 * - 認証状態取得中のUIチラつきを防ぐ初期ローディング状態（isLoading: true）の先行通知。
 * - ネットワーク切断やトークン失効時でも、例外を握り潰さず構造化されたセッションステータスとして返却。
 */

import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  User,
  IdTokenResult,
} from 'firebase/auth';
import { auth, isFirebaseConfigured } from '@/lib/firebase';

export interface SessionStatus {
  isAuthenticated: boolean;
  isAdmin: boolean;
  uid: string | null;
  email: string | null;
  isLoading: boolean;
  errorMessage: string | null;
}

/**
 * 【フールプルーフ】メール・パスワードによる管理者ログイン
 *
 * 処理フロー:
 * 1. 入力値のトリミングおよび空文字検証。
 * 2. Firebase SDK 初期化状態の検証。
 * 3. signInWithEmailAndPassword の実行。
 * 4. 発生した例外エラーコードを日本語メッセージに変換して返却。
 */
export async function loginWithEmailPassword(
  email: string,
  pass: string,
): Promise<User> {
  const cleanEmail = email.trim();
  const cleanPass = pass.trim();

  if (!cleanEmail) {
    throw new Error('メールアドレスを入力してください。');
  }
  if (!cleanPass) {
    throw new Error('パスワードを入力してください。');
  }

  if (!isFirebaseConfigured || !auth) {
    throw new Error(
      'Firebase Authentication が初期化されていません。環境変数を確認してください。',
    );
  }

  try {
    const credential = await signInWithEmailAndPassword(
      auth,
      cleanEmail,
      cleanPass,
    );
    console.info(
      '【運営ログイン成功】UID:',
      credential.user.uid,
      'Email:',
      credential.user.email,
    );
    return credential.user;
  } catch (error: unknown) {
    console.error('【運営ログイン失敗】詳細:', error);
    const errorCode = (error as { code?: string }).code || '';

    switch (errorCode) {
      case 'auth/invalid-email':
        throw new Error('メールアドレスの形式が正しくありません。');
      case 'auth/user-not-found':
      case 'auth/wrong-password':
      case 'auth/invalid-credential':
        throw new Error('メールアドレスまたはパスワードが間違っています。');
      case 'auth/user-disabled':
        throw new Error(
          'このアカウントは無効化されています。システム管理者にご確認ください。',
        );
      case 'auth/too-many-requests':
        throw new Error(
          'ログイン試行回数が上限を超えました。しばらく時間をおいて再度お試しください。',
        );
      case 'auth/network-request-failed':
        throw new Error(
          '通信エラーが発生しました。ネットワーク環境を確認してください。',
        );
      default:
        throw new Error(
          'ログイン処理に失敗しました。認証情報を再確認してください。',
        );
    }
  }
}

/**
 * 【管理者ログアウト】
 */
export async function logoutAdmin(): Promise<void> {
  if (!auth) return;
  try {
    await signOut(auth);
    console.info('【運営ログアウト完了】');
  } catch (error) {
    console.error('【ログアウト失敗】:', error);
    throw error;
  }
}

/**
 * 【フェイルセーフ】運営セッション状態のリアルタイム監視
 *
 * 判定基準:
 * - SSR環境および未初期化時は安全に即時未認証返却。
 * - 監視開始直後に isLoading: true を通知し、画面リダイレクトの誤作動を抑止。
 * - トークンからカスタムクレーム admin を検証し、Firestore ルール (request.auth.token.admin == true) と整合。
 */
export function subscribeAdminSession(
  onStatusChange: (status: SessionStatus) => void,
): () => void {
  if (typeof window === 'undefined' || !isFirebaseConfigured || !auth) {
    onStatusChange({
      isAuthenticated: false,
      isAdmin: false,
      uid: null,
      email: null,
      isLoading: false,
      errorMessage: 'Firebase Authが初期化されていません。',
    });
    return () => {};
  }

  // 初期ローディング状態を先行通知
  onStatusChange({
    isAuthenticated: false,
    isAdmin: false,
    uid: null,
    email: null,
    isLoading: true,
    errorMessage: null,
  });

  const unsubscribe = onAuthStateChanged(
    auth,
    async (user) => {
      if (user && !user.isAnonymous) {
        try {
          // カスタムクレーム (admin: true) の取得検証
          const tokenResult: IdTokenResult = await user.getIdTokenResult();
          const hasAdminClaim = Boolean(tokenResult.claims.admin);

          onStatusChange({
            isAuthenticated: true,
            isAdmin: hasAdminClaim,
            uid: user.uid,
            email: user.email,
            isLoading: false,
            errorMessage: null,
          });
        } catch (tokenErr) {
          console.warn(
            '【トークンクレーム取得警告】基本認証情報で縮退動作します:',
            tokenErr,
          );
          onStatusChange({
            isAuthenticated: true,
            isAdmin: false,
            uid: user.uid,
            email: user.email,
            isLoading: false,
            errorMessage: null,
          });
        }
      } else {
        onStatusChange({
          isAuthenticated: false,
          isAdmin: false,
          uid: null,
          email: null,
          isLoading: false,
          errorMessage: null,
        });
      }
    },
    (error) => {
      console.error('【セッション監視例外】:', error);
      onStatusChange({
        isAuthenticated: false,
        isAdmin: false,
        uid: null,
        email: null,
        isLoading: false,
        errorMessage: error.message,
      });
    },
  );

  return unsubscribe;
}
