import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "大会運営管理コンソール | 第５回めんたいこ杯争奪弓道大会",
  description: "弓道大会のスコア記録・進行制御・名簿編成専用コンソール",
};

export default function AdminLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      {/* 運営専用グローバルバー */}
      <div className="bg-slate-950 border-b border-slate-800 px-4 py-2 flex justify-between items-center text-xs">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 bg-red-500 rounded-full animate-pulse" />
          <span className="font-bold text-slate-200">大会役員・記録員専用コンソール</span>
        </div>
        <a
          href="/"
          className="text-slate-400 hover:text-white underline font-medium"
        >
          選手用ポータル（一般画面）へ
        </a>
      </div>
      <div className="p-4 md:p-8 flex justify-center">
        {children}
      </div>
    </div>
  );
}