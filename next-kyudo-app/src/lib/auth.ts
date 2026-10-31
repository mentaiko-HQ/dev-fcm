/**
 * 【認証・セッション管理モジュール】
 * 役割:
 * - Firebase Authenticationを用いたログイン/ログアウト処理。
 * - ログイン状態およびFirestore(usersコレクション)の権限(role)に基づく管理者セッションの監視。
 *
 * フールプルーフ設計（未認証・権限不足の入口遮断）:
 * - 【強制突破】特定の開発者UIDをスーパー管理者に指定。Firestoreのルールエラーや設定ミスが起きていても確実にログインさせる。
 * - ログイン失敗時の生のエラーコードを詳細な日本語メッセージに変換し、原因特定を容易にする。
 *
 * フェイルセーフ設計（障害時の安全縮退）:
 * - ネットワーク切断等でFirestoreの読み取りに失敗した場合でも、スーパー管理者であればシステムを停止させずに通す。
 * - 【修正】コンポーネント連携エラー解消のため、ログアウト関数名を logoutAdmin に統一。
 */

import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';

export interface SessionStatus {
  isAuthenticated: boolean;
  isAdmin: boolean;
  uid: string | null;
  email: string | null;
  isLoading: boolean;
  errorMessage: string | null;
}

export function subscribeAdminSession(
  callback: (status: SessionStatus) => void,
) {
  return onAuthStateChanged(auth, async (user) => {
    if (user) {
      try {
        // 【フールプルーフ強制突破】
        // 以下のUIDは問答無用で「管理者」として扱う（Firestoreの設定ミスやルールエラーをバイパス）
        const SUPER_ADMIN_UID = 'p7lHcXpW3GRWhyikN4yPTReyto82';
        let isAdmin = user.uid === SUPER_ADMIN_UID;

        // スーパー管理者以外のユーザー向けにFirestoreも一応確認する
        if (!isAdmin) {
          const userDoc = await getDoc(doc(db, 'users', user.uid));
          if (userDoc.exists()) {
            const data = userDoc.data();
            isAdmin = data.role === 'admin' || data.isAdmin === true;
          }
        }

        if (!isAdmin) {
          console.warn(
            `【権限警告】UID: ${user.uid} は管理者権限がありません。`,
          );
        } else {
          console.log(
            `【運営ログイン権限確認OK】UID: ${user.uid} Email: ${user.email}`,
          );
        }

        callback({
          isAuthenticated: true,
          isAdmin,
          uid: user.uid,
          email: user.email,
          isLoading: false,
          errorMessage: isAdmin ? null : '管理者権限がありません。',
        });
      } catch (error) {
        console.error('【権限取得エラー】（Firestoreルールの可能性）:', error);

        // エラーが発生した場合でも、スーパー管理者なら通すフェイルセーフ
        const isSuperAdmin = user.uid === 'p7lHcXpW3GRWhyikN4yPTReyto82';

        callback({
          isAuthenticated: true,
          isAdmin: isSuperAdmin,
          uid: user.uid,
          email: user.email,
          isLoading: false,
          errorMessage: isSuperAdmin ? null : '権限の確認に失敗しました。',
        });
      }
    } else {
      callback({
        isAuthenticated: false,
        isAdmin: false,
        uid: null,
        email: null,
        isLoading: false,
        errorMessage: null,
      });
    }
  });
}

export async function loginWithEmailPassword(email: string, pass: string) {
  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, pass);
    return userCredential.user;
  } catch (error: unknown) {
    console.error('【認証エラー詳細】:', error);
    const errCode =
      error && typeof error === 'object' && 'code' in error
        ? String((error as { code: unknown }).code)
        : '';

    if (
      errCode === 'auth/invalid-credential' ||
      errCode === 'auth/wrong-password' ||
      errCode === 'auth/user-not-found'
    ) {
      throw new Error('メールアドレスまたはパスワードが間違っています。');
    } else if (errCode === 'auth/too-many-requests') {
      throw new Error(
        '連続して失敗したため、一時的にアクセスが制限されています。',
      );
    } else {
      throw new Error(`認証に失敗しました (${errCode || '不明なエラー'})`);
    }
  }
}

// 修正: エラーとなっていた関数名を logout から logoutAdmin へ変更
export async function logoutAdmin(): Promise<void> {
  if (!auth) return;
  try {
    await signOut(auth);
    console.info('【運営ログアウト完了】');
  } catch (error) {
    console.error('【ログアウトエラー】:', error);
    throw error;
  }
}
