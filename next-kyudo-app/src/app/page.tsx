import { TeamSelectForm } from '@/components/shared/TeamSelectForm';
import { ScoreButton } from '@/components/admin/ScoreButton';

export default function HomePage() {
  return (
    <main className="min-h-screen bg-slate-100 p-4 md:p-8 flex flex-col items-center gap-6">
      <header className="w-full max-w-4xl pb-4 border-b border-slate-300 flex justify-between items-center">
        <h1 className="text-xl font-bold text-slate-900">
          弓道大会運営システム
        </h1>
        <span className="text-xs bg-slate-200 text-slate-700 px-2 py-1 rounded">
          2026年大会仕様
        </span>
      </header>

      <div className="w-full max-w-4xl grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* 選手・観客向け チーム選択 & 通知設定 */}
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider">
            選手・付添者用
          </h2>
          <TeamSelectForm />
        </section>

        {/* 役員・スタッフ向け スコア入力サンプル */}
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider">
            競技記録員用
          </h2>
          <ScoreButton playerName="大前: 弓道 太郎" totalArrows={4} />
        </section>
      </div>
    </main>
  );
}
