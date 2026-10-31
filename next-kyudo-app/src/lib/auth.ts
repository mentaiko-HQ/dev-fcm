/**
 * 【認証・セッション管理モジュール】
 * 役割:
 * - Firebase Authenticationを用いたログイン/ログアウト処理。
 * - ログイン状態およびFirestore(usersコレクション)の権限(role)に基づく管理者セッションの監視。
 *
 * フールプルーフ設計:
 * - Firestoreからの権限取得に失敗した場合や、ドキュメントが存在しない場合は、安全側に倒して isAdmin: false とする。
 * - ログイン失敗時の生のエラーコードを詳細な日本語メッセージに変換し、原因特定を容易にする。
 *
 * フェイルセーフ設計:
 * - ネットワーク切断等でFirestoreの読み取りに失敗した場合でもアプリがクラッシュしないよう例外を捕捉。
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
        // Firestoreからユーザーの権限(role)を取得
        const userDoc = await getDoc(doc(db, 'users', user.uid));
        let isAdmin = false;

        if (userDoc.exists()) {
          const data = userDoc.data();
          // role が 'admin' または isAdmin が true の場合に管理者と判定
          isAdmin = data.role === 'admin' || data.isAdmin === true;
        }

        if (!isAdmin) {
          console.warn(
            `【権限警告】UID: ${user.uid} は管理者権限がありません。`,
          );
        } else {
          console.log(
            `【運営ログイン成功】UID: ${user.uid} Email: ${user.email}`,
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
        console.error('【権限取得エラー】', error);
        callback({
          isAuthenticated: true,
          isAdmin: false,
          uid: user.uid,
          email: user.email,
          isLoading: false,
          errorMessage: '権限の確認に失敗しました。',
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

export async function logout() {
  try {
    await signOut(auth);
  } catch (error) {
    console.error('【ログアウトエラー】:', error);
  }
}
