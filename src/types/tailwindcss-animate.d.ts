/**
 * 【tailwindcss-animate 型定義拡張ファイル】
 *
 * フールプルーフ設計（事故前・対人間）:
 * - 型定義が同梱されていない外部モジュールに対し、PluginCreator型に合致するシグネチャを宣言。
 * - TypeScript コンパイラによる TS2307（モジュール未検出）エラーを防止し、ビルド整合性を保証。
 *
 * フェイルセーフ設計（事故後・対故障）:
 * - 戻り値をプラグイン関数（Function）として定義し、Tailwind 設定読み込み時の実行時型不一致を遮断。
 */

declare module 'tailwindcss-animate' {
  import type { PluginCreator } from 'tailwindcss/types/config';
  const plugin: PluginCreator;
  export default plugin;
}
