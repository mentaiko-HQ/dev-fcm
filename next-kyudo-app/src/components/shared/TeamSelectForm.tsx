/**
 * 【参加選手選択＆FCM登録フォームコンポーネント】
 * 役割:
 * - 参加者が自身のエントリー情報（entriesコレクション）を選択し、Push通知(FCM)を受信可能にする。
 * - 匿名認証でUIDを確保し、FCMトークンと選択したentryIdをFirestore (usersコレクション) に紐付け保存。
 *
 * フールプルーフ設計:
 * - ハードコードされたサンプルデータの動的生成処理を完全に排除。Firestore上の実データのみを厳格に表示する。
 * - 選手未選択、または処理中(isSubmitting)はボタンを非活性(disabled)にして二重送信を防止。
 *
 * フェイルセーフ設計:
 * - 取得データが0件の場合（entries.length === 0）、プルダウンを非活性化し専用の警告メッセージを表示。
 * - Firestoreへの保存は { merge: true } を使用し、既存データを破壊せず安全に更新。
 */

'use client';

import React, { useState, useEffect } from 'react';
import { auth, db } from '@/lib/firebase';
import { signInAnonymously, onAuthStateChanged, User } from 'firebase/auth';
import {
  doc,
  getDoc,
  setDoc,
  collection,
  getDocs,
  query,
  orderBy,
} from 'firebase/firestore';
import { requestFcmToken } from '@/lib/fcm';
import { Button } from '@/components/ui/button';
import { Loader2, Bell, CheckCircle2, AlertCircle } from 'lucide-react';

interface Entry {
  id: string;
  bibNumber?: number;
  name: string;
  organization?: string;
}

export function TeamSelectForm() {
  const [user, setUser] = useState<User | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [selectedEntryId, setSelectedEntryId] = useState<string>('');

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [message, setMessage] = useState<{
    type: 'success' | 'error' | 'info';
    text: string;
  } | null>(null);

  useEffect(() => {
    // 1. エントリー一覧の取得（ゼッケン番号順）
    const initialize = async () => {
      try {
        const entriesRef = collection(db, 'entries');
        const q = query(entriesRef, orderBy('bibNumber', 'asc'));
        const querySnapshot = await getDocs(q);

        // Firestoreから取得した「実データ」のみをマッピング
        // ※ ここに存在していたサンプルデータ（team_Aなど）の動的追加処理を削除済
        const loadedEntries = querySnapshot.docs.map((doc) => {
          const data = doc.data();
          return {
            id: doc.id,
            bibNumber: data.bibNumber,
            name: data.name || '名称未設定',
            organization: data.organization || '',
          };
        });

        setEntries(loadedEntries);
      } catch (err) {
        console.error('【エラー】エントリーデータ取得失敗:', err);
      }
    };

    initialize();

    // 2. 匿名認証の確立と既存紐付けの復元
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        setUser(currentUser);
        try {
          const userDoc = await getDoc(doc(db, 'users', currentUser.uid));
          if (userDoc.exists()) {
            const data = userDoc.data();
            if (data.selectedEntryId) {
              setSelectedEntryId(data.selectedEntryId);
              setMessage({
                type: 'info',
                text: '前回の通知設定を復元しました。',
              });
            }
          }
        } catch (err) {
          console.warn('【警告】ユーザーデータ取得失敗:', err);
        }
        setIsLoading(false);
      } else {
        signInAnonymously(auth).catch((err) => {
          console.error('【エラー】匿名認証失敗:', err);
          setMessage({ type: 'error', text: '端末の認証に失敗しました。' });
          setIsLoading(false);
        });
      }
    });

    return () => unsubscribe();
  }, []);

  const handleSubscribe = async () => {
    if (!user) {
      setMessage({ type: 'error', text: '端末の認証が完了していません。' });
      return;
    }
    if (!selectedEntryId) {
      setMessage({ type: 'error', text: '選手を選択してください。' });
      return;
    }

    setIsSubmitting(true);
    setMessage(null);

    try {
      // 3. FCMトークンの要求
      const token = await requestFcmToken();
      if (!token) {
        setMessage({
          type: 'error',
          text: '通知が許可されませんでした。ブラウザの設定から通知を許可してください。',
        });
        setIsSubmitting(false);
        return;
      }

      // 4. Firestoreへ保存（フェイルセーフ: merge:true で他データを破壊しない）
      await setDoc(
        doc(db, 'users', user.uid),
        {
          selectedEntryId: selectedEntryId,
          fcmToken: token,
          updatedAt: new Date().toISOString(),
        },
        { merge: true },
      );

      setMessage({
        type: 'success',
        text: '設定を保存しました！あなたの立の「2つ前」の立が開始された時に呼出通知が届きます。',
      });
    } catch (error) {
      console.error('【エラー】通知設定保存失敗:', error);
      setMessage({
        type: 'error',
        text: '設定の保存に失敗しました。通信環境を確認してください。',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center p-8 space-y-3">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
        <p className="text-xs text-slate-500 font-medium">
          選手リストを読み込み中...
        </p>
      </div>
    );
  }

  return (
    <div className="w-full bg-white border border-slate-200/80 rounded-2xl p-4 shadow-sm space-y-4">
      <div className="space-y-1.5">
        <label className="block text-xs font-bold text-slate-700">
          あなたのお名前（ゼッケン番号）
        </label>
        <select
          value={selectedEntryId}
          onChange={(e) => setSelectedEntryId(e.target.value)}
          disabled={isSubmitting || entries.length === 0}
          className="w-full text-sm p-3 border border-slate-300 rounded-xl focus:outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900 bg-slate-50 text-slate-900 disabled:opacity-50"
        >
          <option value="" disabled>
            ▼ 選手を選択してください
          </option>
          {entries.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.bibNumber ? `[${entry.bibNumber}] ` : ''}
              {entry.name} {entry.organization ? `(${entry.organization})` : ''}
            </option>
          ))}
        </select>

        {/* データが0件の場合の警告表示 */}
        {entries.length === 0 && (
          <p className="text-[10px] text-amber-600 font-bold mt-1">
            ※登録されている選手データがありません
          </p>
        )}
      </div>

      {message && (
        <div
          className={`p-3 rounded-xl flex items-start gap-2 text-xs font-bold animate-in fade-in ${
            message.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
              : message.type === 'error'
                ? 'bg-red-50 text-red-800 border border-red-200'
                : 'bg-blue-50 text-blue-800 border border-blue-200'
          }`}
        >
          {message.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
          ) : (
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          )}
          <span className="leading-relaxed">{message.text}</span>
        </div>
      )}

      <Button
        onClick={handleSubscribe}
        disabled={!selectedEntryId || isSubmitting || entries.length === 0}
        className="w-full py-6 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl shadow-sm transition-all active:scale-95 disabled:opacity-40 text-xs"
      >
        {isSubmitting ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            設定を保存中...
          </>
        ) : (
          <>
            <Bell className="w-4 h-4 mr-1.5" />
            この選手として通知を受け取る
          </>
        )}
      </Button>
    </div>
  );
}
