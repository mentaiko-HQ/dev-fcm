/**
 * 【選手用 招集・待機状況リアルタイム確認ページ】
 * /standby パスに対応するページコンポーネント（FCMプッシュ通知タップ時の標準遷移先）。
 *
 * 役割:
 * 1. FCMプッシュ通知をタップした選手に対し、現在どのステージ・どの組が「招集中」であるかを最上部に大きく表示。
 * 2. そのままワンタップで「リアルタイム成績速報・立順一覧 (/results)」または「トップページ (/)」へ移動できる導線を提供。
 */

'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { LiveCallStatusBanner } from '@/components/shared/LiveCallStatusBanner';
import { Button } from '@/components/ui/button';
import { Target, ArrowLeft, BellRing } from 'lucide-react';

export default function StandbyPage() {
  const router = useRouter();

  return (
    <main className="min-h-screen bg-[#F8FAFC] text-slate-900 p-4 sm:p-6 lg:p-8 space-y-5 max-w-3xl mx-auto w-full">
      <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold bg-slate-900 text-white px-2.5 py-0.5 rounded-full flex items-center gap-1">
              <BellRing className="w-3 h-3 text-amber-400" />
              招集・進行状況確認
            </span>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => router.push('/')}
            className="h-8 px-3 text-xs font-bold border-slate-200 text-slate-700"
          >
            <ArrowLeft className="w-3.5 h-3.5 mr-1" />
            トップへ
          </Button>
        </div>

        {/* リアルタイム招集中ステータスバナー */}
        <LiveCallStatusBanner />

        <div className="pt-2 flex flex-col sm:flex-row gap-2.5">
          <Button
            type="button"
            onClick={() => router.push('/results')}
            className="w-full h-11 bg-slate-900 hover:bg-slate-800 text-white font-black text-xs rounded-xl shadow-xs flex items-center justify-center gap-2"
          >
            <Target className="w-4 h-4 text-amber-400" />
            ステージ別 立順・リアルタイム成績速報を見る
          </Button>
        </div>
      </div>
    </main>
  );
}
