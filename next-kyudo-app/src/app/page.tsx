import { TeamSelectForm } from "@/components/shared/TeamSelectForm";
import { ParticipantDataTable } from "@/components/admin/ParticipantDataTable";
import { StandScoreContainer } from "@/components/admin/StandScoreContainer";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-slate-100 p-4 md:p-8 flex flex-col items-center gap-6">
      <header className="w-full max-w-5xl pb-4 border-b border-slate-300 flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold text-slate-900">弓道大会運営システム</h1>
          <p className="text-xs text-slate-500">リアルタイム進行・スコア管理コンソール</p>
        </div>
        <span className="text-xs bg-slate-200 text-slate-700 px-2.5 py-1 rounded font-medium">2026年公式ルール準拠</span>
      </header>

      {/* 競技記録員用 リアルタイムスコア入力コンソール */}
      <section className="w-full max-w-5xl flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-slate-600 uppercase tracking-wider">競技記録員用 スコア入力コンソール</h2>
        <StandScoreContainer />
      </section>

      {/* 参加者一覧・立順・進行状況テーブル */}
      <section className="w-full max-w-5xl flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-slate-600 uppercase tracking-wider">参加者一覧 / 進行状況</h2>
        <ParticipantDataTable />
      </section>

      {/* 選手・観客向け チーム選択 & 通知設定 */}
      <section className="w-full max-w-5xl flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-slate-600 uppercase tracking-wider">選手・付添者用 招集通知設定</h2>
        <TeamSelectForm />
      </section>
    </main>
  );
}